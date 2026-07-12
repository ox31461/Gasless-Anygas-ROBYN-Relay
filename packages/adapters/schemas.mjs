// robyn-adapters/schemas.mjs — framework-agnostic tool schemas + dispatcher.
//
// Works with any function-calling loop: OpenAI tools, Anthropic tool-use, or your own. No
// framework dependency — just core.mjs. Pair the schemas (what the model sees) with the
// dispatcher (what actually runs).
//
//   import { robynOpenAITools, robynAnthropicTools, robynDispatcher } from 'robyn-adapters/schemas';
//   const tools = robynOpenAITools();                       // -> pass to OpenAI chat.completions
//   const run   = robynDispatcher({ svc, signer });         // -> run(name, args) for each tool call
import { robyn, TOOLS } from './core.mjs';

const chain = { anyOf: [{ type: 'number' }, { type: 'string' }], description: 'chain id or "stellar"' };
const str = (d) => ({ type: 'string', description: d });

const PARAMS = {
  robyn_mesh: { type: 'object', properties: {}, required: [] },
  robyn_quote: { type: 'object', properties: {
    fromChain: chain, fromToken: str(TOOLS.robyn_quote.params.fromToken), toChain: chain,
    toToken: str(TOOLS.robyn_quote.params.toToken), amount: str(TOOLS.robyn_quote.params.amount), toAddress: str(TOOLS.robyn_quote.params.toAddress),
  }, required: ['fromChain', 'fromToken', 'toChain', 'toToken', 'amount'] },
  robyn_route_status: { type: 'object', properties: { id: str(TOOLS.robyn_route_status.params.id) }, required: ['id'] },
  robyn_cross_chain: { type: 'object', properties: {
    fromChain: chain, fromToken: str(TOOLS.robyn_cross_chain.params.fromToken), amount: str(TOOLS.robyn_cross_chain.params.amount),
    toChain: chain, toToken: str(TOOLS.robyn_cross_chain.params.toToken), toAddress: str(TOOLS.robyn_cross_chain.params.toAddress),
  }, required: ['fromChain', 'fromToken', 'amount', 'toChain', 'toToken'] },
};

function names({ includeExecute = true } = {}) {
  const n = ['robyn_mesh', 'robyn_quote', 'robyn_route_status'];
  if (includeExecute) n.push('robyn_cross_chain');
  return n;
}

// OpenAI tools format: [{ type:'function', function:{ name, description, parameters } }]
export function robynOpenAITools(opts) {
  return names(opts).map((name) => ({ type: 'function', function: { name, description: TOOLS[name].description, parameters: PARAMS[name] } }));
}

// Anthropic tool-use format: [{ name, description, input_schema }]
export function robynAnthropicTools(opts) {
  return names(opts).map((name) => ({ name, description: TOOLS[name].description, input_schema: PARAMS[name] }));
}

// Dispatcher — run a tool call by (name, args). Returns the tool's JSON result.
export function robynDispatcher({ svc, signer } = {}) {
  const r = robyn({ svc, signer });
  return async (name, args = {}) => {
    switch (name) {
      case 'robyn_mesh': return r.mesh();
      case 'robyn_quote': return r.quote(args);
      case 'robyn_route_status': return r.status(args.id);
      case 'robyn_cross_chain': return r.crossChain(args);
      default: throw new Error('unknown Robyn tool: ' + name);
    }
  };
}
