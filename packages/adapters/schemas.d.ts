// Type definitions for robyn-adapters/schemas
// Framework-agnostic tool schemas + dispatcher. Works with any function-calling loop:
// OpenAI tools, Anthropic tool-use, or your own.

import type { RobynClientOptions } from './core';

/** Options controlling which tool names are emitted. */
export interface RobynToolOptions {
  /** Include the state-changing `robyn_cross_chain` tool. Defaults to true. */
  includeExecute?: boolean;
}

/** A JSON-schema-ish parameter object for a single tool. */
export interface RobynToolParameters {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
}

/** OpenAI tools format: `{ type:'function', function:{ name, description, parameters } }`. */
export interface RobynOpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: RobynToolParameters;
  };
}

/** Anthropic tool-use format: `{ name, description, input_schema }`. */
export interface RobynAnthropicTool {
  name: string;
  description: string;
  input_schema: RobynToolParameters;
}

/** Build the Robyn tools in OpenAI `chat.completions` format. */
export declare function robynOpenAITools(opts?: RobynToolOptions): RobynOpenAITool[];

/** Build the Robyn tools in Anthropic tool-use format. */
export declare function robynAnthropicTools(opts?: RobynToolOptions): RobynAnthropicTool[];

/** A dispatcher that runs a tool call by (name, args) and returns the tool's JSON result. */
export type RobynDispatch = (name: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Create a dispatcher bound to a Robyn client. */
export declare function robynDispatcher(options?: RobynClientOptions): RobynDispatch;
