import { z } from 'zod';

// Reject NUL and other C0 control characters, except tab, newline, and carriage
// return, which the AppleScript escaper handles. NUL in particular makes Node's
// execFile throw an opaque error before the script ever runs.
// eslint-disable-next-line no-control-regex
const controlCharacters = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

const noControlCharacters = (schema: z.ZodString): z.ZodString =>
  schema.refine((value) => !controlCharacters.test(value), {
    message: 'must not contain NUL or control characters',
  });

const emailAddressSchema = z.email().describe('An email address, e.g. "someone@example.com"');

const recipientObjectSchema = z.strictObject({
  address: emailAddressSchema,
  name: z.string().min(1).optional().describe('Display name for the recipient'),
});

export const recipientSchema = z.union([emailAddressSchema, recipientObjectSchema]);

export type Recipient = z.infer<typeof recipientSchema>;

export interface NormalizedRecipient {
  readonly address: string;
  readonly name?: string;
}

export function normalizeRecipient(recipient: Recipient): NormalizedRecipient {
  if (typeof recipient === 'string') {
    return { address: recipient };
  }
  return recipient.name === undefined
    ? { address: recipient.address }
    : { address: recipient.address, name: recipient.name };
}

export const createDraftShape = {
  to: z
    .array(recipientSchema)
    .min(1)
    .describe('Primary recipients, as bare email addresses or {address, name} objects'),
  cc: z.array(recipientSchema).optional().describe('CC recipients'),
  bcc: z.array(recipientSchema).optional().describe('BCC recipients'),
  subject: noControlCharacters(z.string()).describe('Subject line'),
  body: noControlCharacters(z.string()).describe('Plain-text body of the draft'),
  attachments: z
    .array(z.string().min(1))
    .optional()
    .describe('Absolute POSIX paths of files to attach (a leading "~" is expanded)'),
  sender: emailAddressSchema
    .optional()
    .describe('Address of the Mail account to send from; omit to use the default account'),
  openComposeWindow: z
    .boolean()
    .optional()
    .describe(
      'Open the draft in a compose window and bring Mail to the front (default true); ' +
        'pass false to only save it to the Drafts mailbox in the background',
    ),
} satisfies Record<string, z.ZodType>;

export const createDraftInputSchema = z.strictObject(createDraftShape);

export type CreateDraftInput = z.infer<typeof createDraftInputSchema>;
