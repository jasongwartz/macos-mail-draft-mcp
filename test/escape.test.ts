import { describe, expect, it } from 'vitest';

import { escapeAppleScriptString } from '../src/draft.ts';

describe('escapeAppleScriptString', () => {
  it('passes plain text through unchanged', () => {
    expect(escapeAppleScriptString('hello world')).toBe('hello world');
  });

  it('escapes double quotes', () => {
    expect(escapeAppleScriptString('say "hi"')).toBe('say \\"hi\\"');
  });

  it('escapes backslashes before quotes so escapes cannot be forged', () => {
    expect(escapeAppleScriptString('\\"')).toBe('\\\\\\"');
  });

  it('converts newlines to \\n escapes', () => {
    expect(escapeAppleScriptString('line1\nline2')).toBe('line1\\nline2');
  });

  it('normalizes CRLF and CR to \\n', () => {
    expect(escapeAppleScriptString('a\r\nb\rc')).toBe('a\\nb\\nc');
  });

  it('keeps AppleScript injection attempts inert', () => {
    const hostile = '" & (do shell script "touch /tmp/pwned") & "';
    const escaped = escapeAppleScriptString(hostile);
    // Every quote must be escaped so nothing can break out of the literal.
    expect(escaped).not.toMatch(/(?<!\\)"/);
    expect(escaped).toBe('\\" & (do shell script \\"touch /tmp/pwned\\") & \\"');
  });

  it('leaves unicode untouched', () => {
    expect(escapeAppleScriptString('héllo 👋 日本語')).toBe('héllo 👋 日本語');
  });
});
