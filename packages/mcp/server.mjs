// Robyn MCP server factory — builds the McpServer with its tools registered.
//
// index.mjs (the `anygas-mcp` bin) calls createServer() with the env config and connects it to
// stdio. Exported separately so the tool surface can be exercised in-process (tests, embedding).
//
// Read tools need no credentials. Tools that SIGN (robyn_cross_chain, robyn_agent_execute,
// robyn_yield_spend) are only registered when a signer key is supplied, so a server started
// without ROBYN_SIGNER_KEY is read-only by construction.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { ethers } from 'ethers';

export const DEFAULT_SVC = 'https://api.anygas.xyz/svc';
export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const P2_TYPES = {
  PermitTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' }, { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ],
  TokenPermissions: [ { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' } ] };

const strBig = (o) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
// Parse a service response. JSON error bodies (errorCode/error) are returned as-is so callers can
// branch on errorCode; a non-JSON body (proxy error page, outage) becomes a clear Error.
const readJson = async (r) => {
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error(`Robyn service returned non-JSON (HTTP ${r.status}): ${t.slice(0, 200)}`); }
};
const text = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });

const { version: PKG_VERSION } = createRequire(import.meta.url)('./package.json');

/** Tools registered regardless of credentials. */
export const READ_TOOLS = ['robyn_mesh', 'robyn_quote', 'robyn_route_status', 'robyn_agent_do', 'robyn_errors', 'robyn_yield_account', 'robyn_yield_quote'];
/** Tools that sign with the key; registered only when one is configured. */
export const EXECUTE_TOOLS = ['robyn_cross_chain', 'robyn_agent_execute', 'robyn_yield_spend'];

// createServer({ svc, key }) -> McpServer (not yet connected to a transport)
export function createServer({ svc = DEFAULT_SVC, key = '' } = {}) {
  const SVC = (svc || DEFAULT_SVC).replace(/\/$/, '');
  const KEY = key || '';
  const GET = async (p) => readJson(await fetch(SVC + p));
  const POST = async (p, b) => readJson(await fetch(SVC + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(strBig(b)) }));
  const server = new McpServer({ name: 'robyn', version: PKG_VERSION });

  // ---- read tools (no credentials) -------------------------------------------
  server.registerTool('robyn_mesh',
    { title: 'Robyn mesh', description: 'List the Robyn gasless chains and the cross-chain route graph (22 EVM nodes + Stellar), plus the relayer/Permit2 addresses. No credentials needed.', inputSchema: {} },
    async () => text(await GET('/api/route/chains')));

  server.registerTool('robyn_quote',
    { title: 'Quote a gasless cross-chain route',
      description: 'Best gasless route to move a token from one Robyn chain to another. Returns estimated output, the bridge used, duration, and the Robyn fee. Read-only — moves nothing.',
      inputSchema: {
        fromChain: z.union([z.number(), z.string()]).describe('source chain id, or "stellar"'),
        fromToken: z.string().describe('token address on the source chain (0x0000…0000 for native)'),
        toChain: z.union([z.number(), z.string()]).describe('destination chain id, or "stellar"'),
        toToken: z.string().describe('token address / symbol on the destination'),
        amount: z.string().describe('amount in fromToken base units (e.g. "25000000" = 25 USDC)'),
        toAddress: z.string().optional().describe('recipient on the destination chain'),
      } },
    async (a) => text(await POST('/api/route/quote', a)));

  server.registerTool('robyn_route_status',
    { title: 'Track a cross-chain route', description: 'Status of an in-flight route by id (BRIDGING → DONE), with the destination tx once delivered.', inputSchema: { id: z.string() } },
    async ({ id }) => text(await GET('/api/route/status?id=' + encodeURIComponent(id))));

  // ---- execute (needs ROBYN_SIGNER_KEY; registered only when a key is set) ---
  if (KEY) server.registerTool('robyn_cross_chain',
    { title: 'Move value cross-chain, gasless',
      description: 'Execute a gasless cross-chain move: the server signs ONE Permit2 intent and Robyn fronts all native gas on both chains + the bridge, reimbursed from the token. The agent pays no gas and signs nothing else. Requires ROBYN_SIGNER_KEY in the server env, and a one-time Permit2 approval of the token. Returns a route id — track it with robyn_route_status.',
      inputSchema: {
        fromChain: z.union([z.number(), z.string()]),
        fromToken: z.string().describe('token address on the source chain'),
        amount: z.string().describe('amount in fromToken base units'),
        toChain: z.union([z.number(), z.string()]),
        toToken: z.string().describe('token address / symbol on the destination'),
        toAddress: z.string().optional().describe('recipient (defaults to the signer)'),
      } },
    async (a) => {
      const w = new ethers.Wallet(KEY);
      const ri = await GET('/api/route/chains');
      const spender = ri.relayer;
      if (!spender) return text('Robyn Router relayer/spender unavailable — is the service reachable?');
      const amount = BigInt(a.amount);
      const nonce = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const signature = await w.signTypedData(
        { name: 'Permit2', chainId: Number(a.fromChain), verifyingContract: PERMIT2 },
        P2_TYPES, { permitted: { token: a.fromToken, amount }, spender, nonce, deadline });
      const res = await POST('/api/route/execute', {
        fromChain: a.fromChain, fromToken: a.fromToken, amount: a.amount,
        toChain: a.toChain, toToken: a.toToken, toAddress: a.toAddress || w.address, mode: 'permit2',
        permit2: { owner: w.address, permitted: { token: a.fromToken, amount }, nonce, deadline, signature },
      });
      return text(res);
    });

  // ---- one-call agent surface -------------------------------------------------
  server.registerTool('robyn_agent_do',
    { title: 'Plan a gasless action from one intent',
      description: 'The fastest path from intent to transaction. Send plain language ("send 25 USDC to 0xabc... on arbitrum") or structured fields; returns a quoted plan plus the exact EIP-712 payload to sign. Read-only and needs no key. Set sandbox:true to run the identical path with no funds and nothing broadcast. Branch on status: sign | quoted | done, or on errorCode when refused.',
      inputSchema: {
        intent: z.string().optional().describe('plain-language instruction'),
        fromChain: z.union([z.number(), z.string()]).optional(),
        toChain: z.union([z.number(), z.string()]).optional(),
        token: z.string().optional().describe('symbol, e.g. USDC'),
        amountHuman: z.number().optional().describe('human units, e.g. 25'),
        amount: z.string().optional().describe('base units; overrides amountHuman'),
        toAddress: z.string().optional(),
        sandbox: z.boolean().optional(),
      } },
    async (a) => text(await POST('/api/agent/do', a)));

  server.registerTool('robyn_errors',
    { title: 'Error contract',
      description: 'Every errorCode the API can return, whether it is retryable, how long to wait, and the suggested recovery action. Read once and branch on errorCode instead of parsing messages.',
      inputSchema: {} },
    async () => text(await GET('/api/errors')));

  if (KEY) server.registerTool('robyn_agent_execute',
    { title: 'Do it: plan, sign locally, submit (one call)',
      description: 'End-to-end execution from a single intent. Plans via /api/agent/do, signs the EIP-712 payload the server returns with ROBYN_SIGNER_KEY, and submits it — the relayer fronts all gas. Requires ROBYN_SIGNER_KEY plus a one-time Permit2 approval of the token. Only this local server can do it; the hosted endpoint has no signer. Pass sandbox:true to rehearse with no funds.',
      inputSchema: {
        intent: z.string().optional().describe('plain-language instruction'),
        fromChain: z.union([z.number(), z.string()]).optional(),
        toChain: z.union([z.number(), z.string()]).optional(),
        token: z.string().optional(),
        amountHuman: z.number().optional(),
        amount: z.string().optional(),
        toAddress: z.string().optional(),
        sandbox: z.boolean().optional(),
      } },
    async (a) => {
      const w = new ethers.Wallet(KEY);
      const plan = await POST('/api/agent/do', { ...a, toAddress: a.toAddress || w.address });
      if (plan && plan.errorCode) return text(plan);                 // typed refusal: hand it back as-is
      if (plan && plan.status === 'done') return text(plan);          // sandbox completed, nothing to sign
      const sr = plan && plan.signRequest;
      if (!sr || !sr.eip712) return text({ note: 'nothing to sign — plan did not reach a signable state', plan });
      // Sign the payload the SERVER returned. It already binds spender to the relayer that calls
      // permitTransferFrom; re-deriving these fields locally is how permits become unredeemable.
      const v = sr.eip712.value;
      const signature = await w.signTypedData(sr.eip712.domain, P2_TYPES, v);
      const body = {
        ...sr.submitBody,
        permit2: { owner: w.address, permitted: v.permitted, nonce: v.nonce, deadline: v.deadline, signature },
      };
      const res = await fetch(SVC + '/api/route/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idempotency-key': 'mcp-' + w.address.slice(2, 10) + '-' + Date.now() },
        body: JSON.stringify(strBig(body)),
      }).then(readJson);
      return text({ planned: { rail: plan.rail, receives: plan.receives, understood: plan.understood }, executed: res });
    });

  // ---- non-custodial yield account -------------------------------------------
  server.registerTool('robyn_yield_account',
    { title: 'Non-custodial yield account', description: 'Your own Aave v3 / Moonwell position (aUSDC/mUSDC) per chain + the capped allowance granted to the relayer + APY (best-yield auto-selected). Pass agent, or omit to use the ROBYN_SIGNER_KEY address.', inputSchema: { agent: z.string().optional() } },
    async (a) => { const who = a.agent || (KEY ? new ethers.Wallet(KEY).address : null); if (!who) return text('pass agent, or set ROBYN_SIGNER_KEY'); return text(await GET('/api/ncaccount/' + who)); });
  server.registerTool('robyn_yield_quote',
    { title: 'Quote a spend from yield', description: 'Read-only JIT quote from your yield venue, Aave v3 or Moonwell (draw <= allowance -> withdraw -> gasless deliver).', inputSchema: { srcChain: z.union([z.number(), z.string()]), amount: z.string().describe('USDC base units'), toChain: z.union([z.number(), z.string()]).optional(), toAddress: z.string().optional(), agent: z.string().optional() } },
    async (a) => { const who = a.agent || (KEY ? new ethers.Wallet(KEY).address : null); if (!who) return text('pass agent, or set ROBYN_SIGNER_KEY'); return text(await POST('/api/ncaccount/quote', { agent: who, srcChain: a.srcChain, amount: a.amount, toChain: a.toChain ?? a.srcChain, toAddress: a.toAddress || who })); });
  if (KEY) server.registerTool('robyn_yield_spend',
    { title: 'Spend from yield (one signature)', description: 'Spend from your yield (Aave v3 or Moonwell) with ONE EIP-712 signature: Robyn pulls only up to your on-chain aUSDC/mUSDC allowance, unwinds exactly what is needed, and delivers USDC to toAddress on toChain, gaslessly. Requires ROBYN_SIGNER_KEY + a one-time aUSDC/mUSDC allowance to the relayer. The remainder keeps earning interest.', inputSchema: { srcChain: z.union([z.number(), z.string()]), amount: z.string().describe('USDC base units'), toChain: z.union([z.number(), z.string()]).optional(), toAddress: z.string().optional() } },
    async (a) => {
      const w = new ethers.Wallet(KEY); const src = Number(a.srcChain);
      const intent = { agent: w.address, srcChain: src, amount: String(BigInt(a.amount)), toChain: Number(a.toChain ?? src), toAddress: a.toAddress || w.address, nonce: String(Date.now()) + String(Math.floor(Math.random() * 1e6)), deadline: String(Math.floor(Date.now() / 1000) + 3600) };
      const types = { Spend: [{ name: 'agent', type: 'address' }, { name: 'srcChain', type: 'uint256' }, { name: 'amount', type: 'uint256' }, { name: 'toChain', type: 'uint256' }, { name: 'toAddress', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
      const signature = await w.signTypedData({ name: 'RobynNCAccount', version: '1', chainId: src }, types, intent);
      return text(await POST('/api/ncaccount/spend', { intent, signature, live: true }));
    });

  return server;
}
