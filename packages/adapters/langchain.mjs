// robyn-adapters/langchain.mjs — LangChain tools.
//
//   import { robynLangchainTools } from 'robyn-adapters/langchain';
//   const tools = robynLangchainTools({ svc: 'https://<gateway>/svc', signer });   // signer optional
//   const agent = createReactAgent({ llm, tools });
//
// Returns an array of DynamicStructuredTool. Read tools need no signer; robyn_cross_chain is
// included only when a signer is provided. Tool outputs are JSON strings (LangChain convention).
import { z } from 'zod';
import { robyn, TOOLS } from './core.mjs';

const chain = z.union([z.number(), z.string()]);
const S = (o) => JSON.stringify(o);

// `@langchain/core` is an optional peer — imported dynamically, only required when you use this adapter.
export async function robynLangchainTools({ svc, signer } = {}) {
  const { DynamicStructuredTool } = await import('@langchain/core/tools');
  const r = robyn({ svc, signer });
  const tools = [
    new DynamicStructuredTool({ name: 'robyn_mesh', description: TOOLS.robyn_mesh.description, schema: z.object({}), func: async () => S(await r.mesh()) }),
    new DynamicStructuredTool({
      name: 'robyn_quote', description: TOOLS.robyn_quote.description,
      schema: z.object({ fromChain: chain, fromToken: z.string(), toChain: chain, toToken: z.string(), amount: z.string(), toAddress: z.string().optional() }),
      func: async (a) => S(await r.quote(a)) }),
    new DynamicStructuredTool({ name: 'robyn_route_status', description: TOOLS.robyn_route_status.description, schema: z.object({ id: z.string() }), func: async ({ id }) => S(await r.status(id)) }),
  ];
  if (signer) {
    tools.push(new DynamicStructuredTool({
      name: 'robyn_cross_chain', description: TOOLS.robyn_cross_chain.description,
      schema: z.object({ fromChain: chain, fromToken: z.string(), amount: z.string(), toChain: chain, toToken: z.string(), toAddress: z.string().optional() }),
      func: async (a) => S(await r.crossChain(a)) }));
  }
  return tools;
}
