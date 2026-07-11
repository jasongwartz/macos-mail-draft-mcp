#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createServer } from './server.ts';

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('macos-mail-draft-mcp requires macOS (it drives Mail.app via AppleScript).');
  }
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  process.stderr.write(`Fatal: ${message}\n`);
  process.exitCode = 1;
});
