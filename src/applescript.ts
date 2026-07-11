import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OSASCRIPT_PATH = '/usr/bin/osascript';
const TIMEOUT_MS = 30_000;

export type OsaScriptRunner = (script: string) => Promise<string>;

export class AppleScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppleScriptError';
  }

  static from(error: unknown): AppleScriptError {
    const stderr = extractStderr(error);
    let message = stderr !== '' ? stderr : baseMessage(error);
    if (message.includes('-1743') || message.includes('Not authorized to send Apple events')) {
      message +=
        '\nHint: the host application needs Automation permission for Mail. ' +
        'Grant it in System Settings > Privacy & Security > Automation, then retry.';
    }
    return new AppleScriptError(message);
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
