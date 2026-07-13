#!/usr/bin/env node
// Robyn MCP server — gasless cross-chain for AI agents.
//
// Exposes the Robyn Router as Model Context Protocol tools, so any MCP-capable agent (Claude,
// Cursor, agent frameworks) can quote and execute GASLESS cross-chain moves across 22 EVM chains
// + Stellar — with ZERO gas management. Read tools need no credentials. The execute tool signs a
// single Permit2 intent with ROBYN_SIGNER_KEY; Robyn's relayer fronts all gas on both chains.
//
// Configure (e.g. Claude Desktop mcpServers):
//   command: "npx", args: ["-y", "robyn-mcp"]
//   env: {
//     ROBYN_SVC:        "https://api.anygas.xyz/svc",   // the Robyn service base URL
//     ROBYN_SIGNER_KEY: "0x…"                                  // OPTIONAL — omit for read-only
//   }
// One-time per (token, chain) before executing: the signer must approve Permit2 to spend the
// token — a standard, single ERC-20 approval:  token.approve(0x000000000022D473030F116dDEE9F6B43aC78BA3, MaxUint256)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ethers } from 'ethers';

const SVC = (process.env.ROBYN_SVC || 'https://api.anygas.xyz/svc').replace(/\/$/, '');
const KEY = process.env.ROBYN_SIGNER_KEY || '';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const P2_TYPES = {
  PermitTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' }, { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ],
  TokenPermissions: [ { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' } ] };

const strBig = (o) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
const GET = async (p) => (await fetch(SVC + p)).json();
const POST = async (p, b) => (await fetch(SVC + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(strBig(b)) })).json();
const text = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });

const server = new McpServer({ name: 'robyn', version: '1.0.0' });

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

// ---- execute (needs ROBYN_SIGNER_KEY) --------------------------------------
server.registerTool('robyn_cross_chain',
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
    if (!KEY) return text('ROBYN_SIGNER_KEY is not set — this server is read-only. Set it in the MCP env to enable execution.');
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

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('robyn-mcp connected — svc=' + SVC + (KEY ? ' (execute enabled)' : ' (read-only)'));
