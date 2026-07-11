import { lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';

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
  const to = input.to.map(normalizeRecipient);
  const cc = (input.cc ?? []).map(normalizeRecipient);
  const bcc = (input.bcc ?? []).map(normalizeRecipient);
  const visible = input.openComposeWindow ?? true;
  // Attachments must never be added by a silent background draft: the compose
  // window is the one point where a human sees which files are being attached
  // and to whom, so it is the safeguard against a prompt-injected caller
  // staging file exfiltration unnoticed.
  if (!visible && attachments.length > 0) {
    throw new Error(
      'Attachments require a visible compose window for review: set openComposeWindow to true ' +
        '(or omit it) when attaching files. Silent background drafts cannot carry attachments.',
    );
  }
  const script = buildCreateDraftScript({
    subject: input.subject,
    body: input.body,
    to,
    cc,
    bcc,
    attachments,
    sender: input.sender,
    visible,
  });
  const draftId = await run(script);
  writeAuditLine({
    subject: input.subject,
    to: to.map((r) => r.address),
    cc: cc.map((r) => r.address),
    bcc: bcc.map((r) => r.address),
    attachments,
    visible,
    draftId,
  });
  const attachmentNote =
    attachments.length > 0 ? ` with ${String(attachments.length)} attachment(s)` : '';
  return {
    draftId,
    message: `Created Mail draft "${input.subject}"${attachmentNote} (outgoing message id ${draftId}). It is saved in the Drafts mailbox.`,
  };
}

interface DraftAuditRecord {
  readonly subject: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly attachments: readonly string[];
  readonly visible: boolean;
  readonly draftId: string;
}

/**
 * Emits a single structured audit line to STDERR for every draft created so
 * that silent background drafts (openComposeWindow:false) leave a record of
 * what was drafted, to whom, and with which attachments.
 *
 * This deliberately writes to stderr: stdout is the MCP stdio transport
 * channel and must not be polluted.
 */
export function writeAuditLine(record: DraftAuditRecord): void {
  const line = JSON.stringify({
    event: 'mail-draft.created',
    timestamp: new Date().toISOString(),
    draftId: record.draftId,
    visible: record.visible,
    subject: record.subject,
    to: record.to,
    cc: record.cc,
    bcc: record.bcc,
    attachmentCount: record.attachments.length,
    attachments: record.attachments,
  });
  process.stderr.write(`${line}\n`);
}

async function resolveAttachments(paths: readonly string[]): Promise<readonly string[]> {
  return Promise.all(paths.map(resolveAttachment));
}

async function resolveAttachment(path: string): Promise<string> {
  const expanded = path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;
  if (!isAbsolute(expanded)) {
    throw new Error(`Attachment path must be absolute: ${path}`);
  }
  const hiddenComponent = expanded
    .split(sep)
    .find((component) => component.startsWith('.') && component !== '.' && component !== '..');
  if (hiddenComponent !== undefined) {
    throw new Error(
      `Refusing to attach a file inside a hidden (dot-prefixed) path component ` +
        `("${hiddenComponent}"): ${expanded}. Hidden directories commonly hold secrets ` +
        `(SSH keys, credentials, tokens), so they are blocked. If this file is safe, ` +
        `move or copy it to a non-hidden location and attach it from there.`,
    );
  }
  let info;
  try {
    info = await lstat(expanded);
  } catch {
    throw new Error(`Attachment not found: ${expanded}`);
  }
  if (info.isSymbolicLink()) {
    throw new Error(`Attachment path must not be a symlink: ${expanded}`);
  }
  if (!info.isFile()) {
    throw new Error(`Attachment is not a regular file: ${expanded}`);
  }
  return expanded;
}
