import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildCreateDraftScript, createDraft, type DraftScriptParams } from '../src/draft.ts';

const baseParams: DraftScriptParams = {
  subject: 'Subject',
  body: 'Body text',
  to: [{ address: 'to@example.com', name: 'To Person' }],
  cc: [{ address: 'cc@example.com' }],
  bcc: [],
  attachments: [],
  sender: undefined,
  visible: false,
};

describe('buildCreateDraftScript', () => {
  it('builds a script that creates, saves and returns the draft', () => {
    const script = buildCreateDraftScript(baseParams);
    expect(script).toContain('tell application "Mail"');
    expect(script).toContain(
      'make new outgoing message with properties {subject:"Subject", content:"Body text", visible:false}',
    );
    expect(script).toContain(
      'make new to recipient at end of to recipients with properties {name:"To Person", address:"to@example.com"}',
    );
    expect(script).toContain(
      'make new cc recipient at end of cc recipients with properties {address:"cc@example.com"}',
    );
    expect(script).not.toContain('bcc recipient');
    expect(script).toContain('save theDraft');
    expect(script).toContain('return draftId');
  });

  it('closes the invisible compose session after saving', () => {
    const script = buildCreateDraftScript(baseParams);
    expect(script).toContain('close theDraft saving no');
    expect(script.indexOf('save theDraft')).toBeLessThan(script.indexOf('close theDraft'));
  });

  it('leaves the compose window open and brings Mail to the front when visible', () => {
    const script = buildCreateDraftScript({ ...baseParams, visible: true });
    expect(script).not.toContain('close theDraft');
    expect(script).toContain('activate');
  });

  it('does not activate Mail for invisible drafts', () => {
    expect(buildCreateDraftScript(baseParams)).not.toContain('activate');
  });

  it('includes the sender when provided', () => {
    const script = buildCreateDraftScript({ ...baseParams, sender: 'me@example.com' });
    expect(script).toContain('sender:"me@example.com"');
  });

  it('adds attachments inside the content and delays before saving', () => {
    const script = buildCreateDraftScript({
      ...baseParams,
      attachments: ['/tmp/report.pdf', '/tmp/photo.png'],
    });
    expect(script).toContain('tell content of theDraft');
    expect(script).toContain(
      'make new attachment with properties {file name:POSIX file "/tmp/report.pdf"} at after the last paragraph',
    );
    expect(script).toContain(
      'make new attachment with properties {file name:POSIX file "/tmp/photo.png"} at after the last paragraph',
    );
    expect(script.indexOf('delay 1')).toBeLessThan(script.indexOf('save theDraft'));
  });

  it('omits the pre-save delay when there are no attachments', () => {
    const script = buildCreateDraftScript({ ...baseParams, visible: true });
    expect(script).not.toContain('delay');
  });

  it('escapes hostile values everywhere they are embedded', () => {
    const script = buildCreateDraftScript({
      ...baseParams,
      subject: 'quote " here',
      body: 'line1\nline2 "quoted"',
      to: [{ address: 'to@example.com', name: 'Evil " Name' }],
    });
    expect(script).toContain('subject:"quote \\" here"');
    expect(script).toContain('content:"line1\\nline2 \\"quoted\\""');
    expect(script).toContain('name:"Evil \\" Name"');
  });

  it('marks the draft visible when requested', () => {
    expect(buildCreateDraftScript({ ...baseParams, visible: true })).toContain('visible:true');
  });
});

describe('createDraft', () => {
  let dir: string;
  let attachmentPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mail-draft-test-'));
    attachmentPath = join(dir, 'file.txt');
    await writeFile(attachmentPath, 'attachment contents');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a structured audit line to stderr for every draft', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await createDraft(
      {
        to: ['to@example.com'],
        cc: ['cc@example.com'],
        bcc: ['bcc@example.com'],
        subject: 'Hi',
        body: 'Hello',
        openComposeWindow: false,
        attachments: [attachmentPath],
      },
      () => Promise.resolve('99'),
    );
    expect(stderr).toHaveBeenCalledTimes(1);
    const written = stderr.mock.calls[0]?.[0];
    expect(typeof written).toBe('string');
    const audit: unknown = JSON.parse((written as string).trimEnd());
    expect(audit).toMatchObject({
      event: 'mail-draft.created',
      draftId: '99',
      visible: false,
      subject: 'Hi',
      to: ['to@example.com'],
      cc: ['cc@example.com'],
      bcc: ['bcc@example.com'],
      attachmentCount: 1,
      attachments: [attachmentPath],
    });
    expect((audit as { timestamp: string }).timestamp).toEqual(expect.any(String));
  });

  it('records visible drafts as visible in the audit line', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await createDraft({ to: ['to@example.com'], subject: 'Hi', body: 'Hello' }, () =>
      Promise.resolve('1'),
    );
    const audit: unknown = JSON.parse((stderr.mock.calls[0]?.[0] as string).trimEnd());
    expect(audit).toMatchObject({ visible: true, attachmentCount: 0 });
  });

  it('opens a compose window by default', async () => {
    const scripts: string[] = [];
    await createDraft({ to: ['to@example.com'], subject: 'Hi', body: 'Hello' }, (script) => {
      scripts.push(script);
      return Promise.resolve('1');
    });
    expect(scripts[0]).toContain('visible:true');
    expect(scripts[0]).toContain('activate');
    expect(scripts[0]).not.toContain('close theDraft');
  });

  it('saves silently when openComposeWindow is false', async () => {
    const scripts: string[] = [];
    await createDraft(
      { to: ['to@example.com'], subject: 'Hi', body: 'Hello', openComposeWindow: false },
      (script) => {
        scripts.push(script);
        return Promise.resolve('1');
      },
    );
    expect(scripts[0]).toContain('visible:false');
    expect(scripts[0]).toContain('close theDraft saving no');
  });

  it('runs the generated script and reports the draft id', async () => {
    const scripts: string[] = [];
    const result = await createDraft(
      { to: ['to@example.com'], subject: 'Hi', body: 'Hello' },
      (script) => {
        scripts.push(script);
        return Promise.resolve('42');
      },
    );
    expect(result.draftId).toBe('42');
    expect(result.message).toContain('outgoing message id 42');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('subject:"Hi"');
  });

  it('resolves attachments and passes them to the script', async () => {
    const scripts: string[] = [];
    await createDraft(
      {
        to: ['to@example.com'],
        subject: 'Hi',
        body: 'Hello',
        attachments: [attachmentPath],
      },
      (script) => {
        scripts.push(script);
        return Promise.resolve('7');
      },
    );
    expect(scripts[0]).toContain(`POSIX file "${attachmentPath}"`);
  });

  it('rejects relative attachment paths without running any script', async () => {
    let ran = false;
    await expect(
      createDraft(
        { to: ['to@example.com'], subject: 'Hi', body: 'Hello', attachments: ['file.txt'] },
        () => {
          ran = true;
          return Promise.resolve('0');
        },
      ),
    ).rejects.toThrow(/must be absolute/);
    expect(ran).toBe(false);
  });

  it('rejects attachments that do not exist', async () => {
    await expect(
      createDraft(
        {
          to: ['to@example.com'],
          subject: 'Hi',
          body: 'Hello',
          attachments: [join(dir, 'missing.bin')],
        },
        () => Promise.resolve('0'),
      ),
    ).rejects.toThrow(/not found/);
  });

  it('rejects attachments inside a hidden (dot-prefixed) path component', async () => {
    const hiddenDir = join(dir, '.ssh');
    await mkdir(hiddenDir);
    const secretPath = join(hiddenDir, 'id_rsa');
    await writeFile(secretPath, 'PRIVATE KEY');
    let ran = false;
    await expect(
      createDraft(
        { to: ['to@example.com'], subject: 'Hi', body: 'Hello', attachments: [secretPath] },
        () => {
          ran = true;
          return Promise.resolve('0');
        },
      ),
    ).rejects.toThrow(/hidden \(dot-prefixed\)/);
    expect(ran).toBe(false);
  });

  it('rejects attachments that are not regular files', async () => {
    await expect(
      createDraft(
        { to: ['to@example.com'], subject: 'Hi', body: 'Hello', attachments: [dir] },
        () => Promise.resolve('0'),
      ),
    ).rejects.toThrow(/not a regular file/);
  });

  it('rejects a symlink pointing at a valid file without running any script', async () => {
    const linkPath = join(dir, 'link.txt');
    await symlink(attachmentPath, linkPath);
    let ran = false;
    await expect(
      createDraft(
        { to: ['to@example.com'], subject: 'Hi', body: 'Hello', attachments: [linkPath] },
        () => {
          ran = true;
          return Promise.resolve('0');
        },
      ),
    ).rejects.toThrow(/must not be a symlink/);
    expect(ran).toBe(false);
  });

  it('refuses attachments on a silent draft without running any script', async () => {
    let ran = false;
    await expect(
      createDraft(
        {
          to: ['to@example.com'],
          subject: 'Hi',
          body: 'Hello',
          openComposeWindow: false,
          attachments: [attachmentPath],
        },
        () => {
          ran = true;
          return Promise.resolve('0');
        },
      ),
    ).rejects.toThrow(/require a visible compose window/);
    expect(ran).toBe(false);
  });
});
