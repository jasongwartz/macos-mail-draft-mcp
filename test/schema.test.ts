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
