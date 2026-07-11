import { describe, expect, it } from 'vitest';

import { createDraftInputSchema, normalizeRecipient } from '../src/schema.ts';

const minimalInput = {
  to: ['someone@example.com'],
  subject: 'Hello',
  body: 'Hi there',
};

describe('createDraftInputSchema', () => {
  it('accepts a minimal valid input', () => {
    const result = createDraftInputSchema.safeParse(minimalInput);
    expect(result.success).toBe(true);
  });

  it('accepts recipients as objects with a display name', () => {
    const result = createDraftInputSchema.safeParse({
      ...minimalInput,
      to: [{ address: 'someone@example.com', name: 'Someone' }],
      cc: ['cc@example.com'],
      bcc: [{ address: 'bcc@example.com' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty to list', () => {
    const result = createDraftInputSchema.safeParse({ ...minimalInput, to: [] });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email addresses', () => {
    const result = createDraftInputSchema.safeParse({ ...minimalInput, to: ['not-an-email'] });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid sender address', () => {
    const result = createDraftInputSchema.safeParse({ ...minimalInput, sender: 'nope' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys', () => {
    const result = createDraftInputSchema.safeParse({ ...minimalInput, htmlBody: '<b>hi</b>' });
    expect(result.success).toBe(false);
  });

  it('rejects empty attachment paths', () => {
    const result = createDraftInputSchema.safeParse({ ...minimalInput, attachments: [''] });
    expect(result.success).toBe(false);
  });

  it('rejects a subject containing a NUL byte', () => {
    const result = createDraftInputSchema.safeParse({ ...minimalInput, subject: 'Hel\x00lo' });
    expect(result.success).toBe(false);
  });

  it('rejects a body containing a NUL byte', () => {
    const result = createDraftInputSchema.safeParse({ ...minimalInput, body: 'Hi\x00there' });
    expect(result.success).toBe(false);
  });

  it('accepts a body with newlines, tabs, and carriage returns', () => {
    const result = createDraftInputSchema.safeParse({
      ...minimalInput,
      body: 'Line one\nLine two\tindented\r\nLine three',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an over-long subject', () => {
    const result = createDraftInputSchema.safeParse({ ...minimalInput, subject: 'x'.repeat(999) });
    expect(result.success).toBe(false);
  });

  it('rejects an over-long body', () => {
    const result = createDraftInputSchema.safeParse({
      ...minimalInput,
      body: 'x'.repeat(256 * 1024 + 1),
    });
    expect(result.success).toBe(false);
  });

  it('rejects too many recipients', () => {
    const many = Array.from({ length: 101 }, (_, i) => `person${String(i)}@example.com`);
    expect(createDraftInputSchema.safeParse({ ...minimalInput, to: many }).success).toBe(false);
    expect(createDraftInputSchema.safeParse({ ...minimalInput, cc: many }).success).toBe(false);
    expect(createDraftInputSchema.safeParse({ ...minimalInput, bcc: many }).success).toBe(false);
  });

  it('rejects too many attachments', () => {
    const attachments = Array.from({ length: 21 }, (_, i) => `/tmp/file${String(i)}.txt`);
    const result = createDraftInputSchema.safeParse({ ...minimalInput, attachments });
    expect(result.success).toBe(false);
  });

  it('rejects an over-long attachment path', () => {
    const result = createDraftInputSchema.safeParse({
      ...minimalInput,
      attachments: [`/tmp/${'x'.repeat(4097)}`],
    });
    expect(result.success).toBe(false);
  });
});

describe('normalizeRecipient', () => {
  it('wraps bare addresses', () => {
    expect(normalizeRecipient('a@b.com')).toEqual({ address: 'a@b.com' });
  });

  it('keeps address and name from objects', () => {
    expect(normalizeRecipient({ address: 'a@b.com', name: 'A B' })).toEqual({
      address: 'a@b.com',
      name: 'A B',
    });
  });

  it('omits the name key when the object has none', () => {
    const normalized = normalizeRecipient({ address: 'a@b.com' });
    expect('name' in normalized).toBe(false);
  });
});
