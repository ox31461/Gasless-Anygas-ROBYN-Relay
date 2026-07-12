// robyn-adapters/ai-sdk.mjs — Vercel AI SDK tools.
//
//   import { robynTools } from 'robyn-adapters/ai-sdk';
//   const tools = robynTools({ svc: 'https://<gateway>/svc', signer });   // signer optional
//   const result = await generateText({ model, tools, prompt: 'move 25 USDC from Base to Arbitrum' });
//
// Read tools (mesh/quote/status) work with no signer. robyn_cross_chain is only added when a
// signer is provided. The signer only signs a Permit2 intent; Robyn's relayer fronts all gas.
import { z } from 'zod';
import { robyn, TOOLS } from './core.mjs';

const chain = z.union([z.number(), z.string()]);

// `ai` is an optional peer — imported dynamically so it's only required when you actually use this adapter.
export async function robynTools({ svc, signer } = {}) {
  const { tool } = await import('ai');
  const r = robyn({ svc, signer });
  const tools = {
    robyn_mesh: tool({ description: TOOLS.robyn_mesh.description, parameters: z.object({}), execute: async () => r.mesh() }),
    robyn_quote: tool({
      description: TOOLS.robyn_quote.description,
      parameters: z.object({ fromChain: chain, fromToken: z.string(), toChain: chain, toToken: z.string(), amount: z.string(), toAddress: z.string().optional() }),
      execute: async (a) => r.quote(a) }),
    robyn_route_status: tool({ description: TOOLS.robyn_route_status.description, parameters: z.object({ id: z.string() }), execute: async ({ id }) => r.status(id) }),
  };
  if (signer) {
    tools.robyn_cross_chain = tool({
      description: TOOLS.robyn_cross_chain.description,
      parameters: z.object({ fromChain: chain, fromToken: z.string(), amount: z.string(), toChain: chain, toToken: z.string(), toAddress: z.string().optional() }),
      execute: async (a) => r.crossChain(a) });
  }
  return tools;
}
