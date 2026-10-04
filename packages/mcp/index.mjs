#!/usr/bin/env node
// @ts-self-types="./index.d.ts"
// Robyn MCP server — gasless cross-chain for AI agents.
//
// Exposes the Robyn Router as Model Context Protocol tools, so any MCP-capable agent (Claude,
// Cursor, agent frameworks) can quote and execute GASLESS cross-chain moves across 22 EVM chains
// + Stellar — with ZERO gas management. Read tools need no credentials. The execute tools sign a
// single intent with ROBYN_SIGNER_KEY and are only exposed when it is set; Robyn's relayer fronts
// all gas on both chains.
//
// Configure (e.g. Claude Desktop mcpServers):
//   command: "npx", args: ["-y", "anygas-mcp"]
//   env: {
//     ROBYN_SVC:        "https://api.anygas.xyz/svc",   // the Robyn service base URL
//     ROBYN_SIGNER_KEY: "0x…"                                  // OPTIONAL — omit for read-only
//   }
// One-time per (token, chain) before executing: the signer must approve Permit2 to spend the
// token — a standard, single ERC-20 approval:  token.approve(0x000000000022D473030F116dDEE9F6B43aC78BA3, MaxUint256)
//
// The tool definitions live in server.mjs (createServer); this file is just the stdio entry point.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, DEFAULT_SVC } from './server.mjs';

const SVC = (process.env.ROBYN_SVC || DEFAULT_SVC).replace(/\/$/, '');
const KEY = process.env.ROBYN_SIGNER_KEY || '';

const server = createServer({ svc: SVC, key: KEY });
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('robyn-mcp connected — svc=' + SVC + (KEY ? ' (execute enabled)' : ' (read-only)'));
