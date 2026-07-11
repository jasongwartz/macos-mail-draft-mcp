import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { AppleScriptError } from './applescript.ts';
import { createDraft } from './draft.ts';
import { createDraftShape } from './schema.ts';

export const SERVER_NAME = 'macos-mail-draft';
export const SERVER_VERSION = '0.1.0';

export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'create_mail_draft',
    {
      title: 'Create Mail draft',
      description:
        'Creates a draft email in the macOS Mail app (saved to the Drafts mailbox) with ' +
        'recipients, a plain-text body, and optional file attachments. Nothing is sent.',
      inputSchema: createDraftShape,
    },
    async (input): Promise<CallToolResult> => {
      try {
        const result = await createDraft(input);
        return { content: [{ type: 'text', text: result.message }] };
      } catch (error: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: describeError(error) }],
        };
      }
    },
  );

  return server;
}

function describeError(error: unknown): string {
  // osascript stderr can echo the generated script and absolute filesystem
  // paths, so never surface its raw detail to the caller. Log the full detail
  // to the server's own stderr and return only the generic, host-agnostic
  // message (plus the safe permission hint when applicable).
  if (error instanceof AppleScriptError) {
    process.stderr.write(`create_mail_draft failed: ${error.detail}\n`);
    return error.safeMessage;
  }
  if (error instanceof Error) {
    return `Failed to create draft: ${error.message}`;
  }
  return 'Failed to create draft: unknown error';
}
