import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OSASCRIPT_PATH = '/usr/bin/osascript';
const TIMEOUT_MS = 30_000;

export type OsaScriptRunner = (script: string) => Promise<string>;

const GENERIC_FAILURE_MESSAGE = 'Failed to create draft. See server logs for details.';

const PERMISSION_HINT =
  'The host application needs Automation permission for Mail. ' +
  'Grant it in System Settings > Privacy & Security > Automation, then retry.';

/**
 * Error raised when osascript fails. The raw osascript stderr can echo parts
 * of the generated script and absolute filesystem paths, so it is kept in
 * `detail` (for server-side logging only) and never surfaced to the caller.
 * `safeMessage` holds a generic, host-agnostic message that is safe to return
 * to the tool caller (the LLM/tool result).
 */
export class AppleScriptError extends Error {
  /** Full, potentially host-revealing detail. For server-side logging only. */
  readonly detail: string;
  /** Generic message safe to surface to the caller. */
  readonly safeMessage: string;

  constructor(detail: string, safeMessage: string) {
    super(detail);
    this.name = 'AppleScriptError';
    this.detail = detail;
    this.safeMessage = safeMessage;
  }

  static from(error: unknown): AppleScriptError {
    const stderr = extractStderr(error);
    const detail = stderr !== '' ? stderr : baseMessage(error);
    let safeMessage = GENERIC_FAILURE_MESSAGE;
    if (detail.includes('-1743') || detail.includes('Not authorized to send Apple events')) {
      // The permission hint contains no host-specific data, so it is safe to
      // surface to the caller alongside the generic failure message.
      safeMessage += `\nHint: ${PERMISSION_HINT}`;
    }
    return new AppleScriptError(detail, safeMessage);
  }
}

function baseMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'osascript failed with a non-Error value';
}

function extractStderr(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'stderr' in error) {
    const { stderr } = error;
    if (typeof stderr === 'string') {
      return stderr.trim();
    }
  }
  return '';
}

export const runAppleScript: OsaScriptRunner = async (script) => {
  try {
    const { stdout } = await execFileAsync(OSASCRIPT_PATH, ['-e', script], {
      timeout: TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error: unknown) {
    throw AppleScriptError.from(error);
  }
};
