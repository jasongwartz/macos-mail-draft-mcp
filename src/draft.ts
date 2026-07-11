import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { runAppleScript, type OsaScriptRunner } from './applescript.ts';
import { normalizeRecipient, type CreateDraftInput, type NormalizedRecipient } from './schema.ts';

/**
 * Escapes a value for embedding inside a double-quoted AppleScript string
 * literal. AppleScript string literals only interpret \\ , \" , \n , \r and
 * \t, so escaping backslashes and quotes (and normalizing newlines) is
 * sufficient to keep arbitrary input inert.
 */
export function escapeAppleScriptString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, '\n')
    .replace(/[\n\r]/g, '\\n');
}

export interface DraftScriptParams {
  readonly subject: string;
  readonly body: string;
  readonly to: readonly NormalizedRecipient[];
  readonly cc: readonly NormalizedRecipient[];
  readonly bcc: readonly NormalizedRecipient[];
  readonly attachments: readonly string[];
  readonly sender: string | undefined;
  readonly visible: boolean;
}

export function buildCreateDraftScript(params: DraftScriptParams): string {
  const q = escapeAppleScriptString;
  const properties = [
    `subject:"${q(params.subject)}"`,
    `content:"${q(params.body)}"`,
    `visible:${String(params.visible)}`,
  ];
  if (params.sender !== undefined) {
    properties.push(`sender:"${q(params.sender)}"`);
  }

  const lines = [
    'tell application "Mail"',
    `\tset theDraft to make new outgoing message with properties {${properties.join(', ')}}`,
    '\ttell theDraft',
  ];

  const recipientGroups = [
    ['to', params.to],
    ['cc', params.cc],
    ['bcc', params.bcc],
  ] as const;
  for (const [kind, recipients] of recipientGroups) {
    for (const recipient of recipients) {
      const recipientProperties =
        recipient.name === undefined
          ? `{address:"${q(recipient.address)}"}`
          : `{name:"${q(recipient.name)}", address:"${q(recipient.address)}"}`;
      lines.push(
        `\t\tmake new ${kind} recipient at end of ${kind} recipients with properties ${recipientProperties}`,
      );
    }
  }
  lines.push('\tend tell');

  if (params.attachments.length > 0) {
    lines.push('\ttell content of theDraft');
    for (const attachment of params.attachments) {
      lines.push(
        `\t\tmake new attachment with properties {file name:POSIX file "${q(attachment)}"} at after the last paragraph`,
      );
    }
    lines.push('\tend tell');
    // Mail silently drops attachments if the draft is saved in the same
    // instant they are added.
    lines.push('\tdelay 1');
  }

  lines.push('\tsave theDraft', '\tset draftId to id of theDraft');
  if (params.visible) {
    // visible:true opens the compose window inside Mail but does not bring
    // Mail itself to the foreground.
    lines.push('\tactivate');
  } else {
    // Saving keeps the draft in the Drafts mailbox, but the (invisible)
    // compose session lingers until its window is closed. Mail needs a
    // moment after save before the close reliably tears the window down.
    lines.push('\tdelay 1', '\tclose theDraft saving no');
  }
  lines.push('\treturn draftId', 'end tell');
  return lines.join('\n');
}

export interface CreateDraftResult {
  readonly draftId: string;
  readonly message: string;
}

export async function createDraft(
  input: CreateDraftInput,
  run: OsaScriptRunner = runAppleScript,
): Promise<CreateDraftResult> {
  const attachments = await resolveAttachments(input.attachments ?? []);
  const script = buildCreateDraftScript({
    subject: input.subject,
    body: input.body,
    to: input.to.map(normalizeRecipient),
    cc: (input.cc ?? []).map(normalizeRecipient),
    bcc: (input.bcc ?? []).map(normalizeRecipient),
    attachments,
    sender: input.sender,
    visible: input.openComposeWindow ?? true,
  });
  const draftId = await run(script);
  const attachmentNote =
    attachments.length > 0 ? ` with ${String(attachments.length)} attachment(s)` : '';
  return {
    draftId,
    message: `Created Mail draft "${input.subject}"${attachmentNote} (outgoing message id ${draftId}). It is saved in the Drafts mailbox.`,
  };
}

async function resolveAttachments(paths: readonly string[]): Promise<readonly string[]> {
  return Promise.all(paths.map(resolveAttachment));
}

async function resolveAttachment(path: string): Promise<string> {
  const expanded = path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;
  if (!isAbsolute(expanded)) {
    throw new Error(`Attachment path must be absolute: ${path}`);
  }
  let info;
  try {
    info = await stat(expanded);
  } catch {
    throw new Error(`Attachment not found: ${expanded}`);
  }
  if (!info.isFile()) {
    throw new Error(`Attachment is not a regular file: ${expanded}`);
  }
  return expanded;
}
