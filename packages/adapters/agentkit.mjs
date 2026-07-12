// robyn-adapters/agentkit.mjs — Coinbase AgentKit action provider.
//
//   import { robynActionProvider } from 'robyn-adapters/agentkit';
//   const agentkit = await AgentKit.from({ walletProvider,
//     actionProviders: [ robynActionProvider({ svc: 'https://<gateway>/svc', signer }) ] });
//
// Read actions need no signer. robyn_cross_chain is included only when a signer is provided
// (an ethers v6 Signer used purely to sign the Permit2 intent). Action results are JSON strings.
import { z } from 'zod';
import { robyn, TOOLS } from './core.mjs';

const chain = z.union([z.number(), z.string()]);
const S = (o) => JSON.stringify(o);

// `@coinbase/agentkit` is an optional peer — imported dynamically, only required when you use this adapter.
export async function robynActionProvider({ svc, signer } = {}) {
  const { customActionProvider } = await import('@coinbase/agentkit');
  const r = robyn({ svc, signer });
  const actions = [
    { name: 'robyn_mesh', description: TOOLS.robyn_mesh.description, schema: z.object({}), invoke: async () => S(await r.mesh()) },
    { name: 'robyn_quote', description: TOOLS.robyn_quote.description,
      schema: z.object({ fromChain: chain, fromToken: z.string(), toChain: chain, toToken: z.string(), amount: z.string(), toAddress: z.string().optional() }),
      invoke: async (_wp, a) => S(await r.quote(a)) },
    { name: 'robyn_route_status', description: TOOLS.robyn_route_status.description, schema: z.object({ id: z.string() }), invoke: async (_wp, { id }) => S(await r.status(id)) },
  ];
  if (signer) {
    actions.push({ name: 'robyn_cross_chain', description: TOOLS.robyn_cross_chain.description,
      schema: z.object({ fromChain: chain, fromToken: z.string(), amount: z.string(), toChain: chain, toToken: z.string(), toAddress: z.string().optional() }),
      invoke: async (_wp, a) => S(await r.crossChain(a)) });
  }
  return customActionProvider(actions);
}
