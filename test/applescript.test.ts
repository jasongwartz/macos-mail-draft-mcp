import { describe, expect, it } from 'vitest';

import { AppleScriptError } from '../src/applescript.ts';

describe('AppleScriptError.from', () => {
  it('keeps raw stderr as detail but never leaks it into safeMessage', () => {
    const stderr =
      '/Users/someone/secret/script.scpt:12:34: execution error: ' +
      'Mail got an error (-1728) at line 3 of "tell application ..."';
    const error = AppleScriptError.from({ stderr });
    // Full detail is preserved for server-side logging.
    expect(error.detail).toBe(stderr);
    // The caller-facing message is generic and reveals no host details.
    expect(error.safeMessage).toBe('Failed to create draft. See server logs for details.');
    expect(error.safeMessage).not.toContain('/Users/someone');
    expect(error.safeMessage).not.toContain('tell application');
  });

  it('falls back to the Error message as detail when there is no stderr', () => {
    const error = AppleScriptError.from(new Error('spawn ENOENT'));
    expect(error.detail).toBe('spawn ENOENT');
    expect(error.safeMessage).toBe('Failed to create draft. See server logs for details.');
  });

  it('trims stderr for the detail', () => {
    const error = AppleScriptError.from({ stderr: '  boom  \n' });
    expect(error.detail).toBe('boom');
  });

  it('appends the safe Automation-permission hint for -1743 errors', () => {
    const stderr =
      '/private/tmp/x.scpt: execution error: Not authorized to send Apple events to Mail. (-1743)';
    const error = AppleScriptError.from({ stderr });
    expect(error.safeMessage).toContain('Failed to create draft. See server logs for details.');
    expect(error.safeMessage).toContain('Automation permission for Mail');
    // The hint itself must not carry host-specific data through.
    expect(error.safeMessage).not.toContain('/private/tmp');
    // The full detail is still available for logging.
    expect(error.detail).toBe(stderr);
  });

  it('does not add the permission hint for unrelated failures', () => {
    const error = AppleScriptError.from({ stderr: 'execution error: some other failure' });
    expect(error.safeMessage).toBe('Failed to create draft. See server logs for details.');
    expect(error.safeMessage).not.toContain('Automation');
  });

  it('handles non-Error, non-stderr values without leaking them', () => {
    const error = AppleScriptError.from('surprise string');
    expect(error.detail).toBe('osascript failed with a non-Error value');
    expect(error.safeMessage).toBe('Failed to create draft. See server logs for details.');
  });
});
