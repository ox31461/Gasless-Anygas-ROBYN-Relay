// Spawns the real `anygas-mcp` bin over stdio and lists its tools. listTools makes no network
// calls, so this stays offline. ROBYN_SVC points at an unroutable host just in case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ethers } from 'ethers';
import { READ_TOOLS, EXECUTE_TOOLS } from '../server.mjs';

const BIN = fileURLToPath(new URL('../index.mjs', import.meta.url));

async function listToolsWithEnv(extra) {
  const env = { ...process.env, ROBYN_SVC: 'http://127.0.0.1:9/svc', ...extra };
  if (!extra.ROBYN_SIGNER_KEY) delete env.ROBYN_SIGNER_KEY;
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN], env, stderr: 'pipe' });
  const client = new Client({ name: 'bin-test', version: '0.0.0' });
  await client.connect(transport);
  try {
    return (await client.listTools()).tools.map((t) => t.name).sort();
  } finally {
    await client.close();
  }
}

test('bin without ROBYN_SIGNER_KEY exposes only read-only tools', async () => {
  assert.deepEqual(await listToolsWithEnv({}), [...READ_TOOLS].sort());
});

test('bin with ROBYN_SIGNER_KEY exposes the execute tools', async () => {
  const names = await listToolsWithEnv({ ROBYN_SIGNER_KEY: ethers.Wallet.createRandom().privateKey });
  assert.deepEqual(names, [...READ_TOOLS, ...EXECUTE_TOOLS].sort());
});
