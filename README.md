# macos-mail-draft-mcp

An MCP (Model Context Protocol) server that creates email drafts in the macOS
Mail app. Everything runs locally: the server drives Mail.app through
AppleScript (`osascript`) — no network services, no credentials, and nothing is
ever sent.

## Requirements

- macOS with Mail.app configured with at least one account
- Node.js >= 24 (runs the TypeScript source directly — there is no build step
  and no compiled artifacts; `erasableSyntaxOnly` keeps the source
  type-strippable)

## Setup

```sh
npm install
```

### Register with Claude Code

```sh
claude mcp add macos-mail-draft -- node /absolute/path/to/macos-mail-draft-mcp/src/index.ts
```

### Register with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "macos-mail-draft": {
      "command": "node",
      "args": ["/absolute/path/to/macos-mail-draft-mcp/src/index.ts"]
    }
  }
}
```

### Automation permission

The first time a draft is created, macOS asks the host application (your
terminal, Claude Desktop, etc.) for permission to control Mail. If a call fails
with "Not authorized to send Apple events", grant access under
**System Settings > Privacy & Security > Automation**.

## Tool: `create_mail_draft`

Creates a draft in Mail's Drafts mailbox. Nothing is sent.

| Parameter           | Type                                          | Required | Description                                                                                                   |
| ------------------- | --------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `to`                | array of address strings or `{address, name}` | yes      | Primary recipients                                                                                            |
| `subject`           | string                                        | yes      | Subject line                                                                                                  |
| `body`              | string                                        | yes      | Plain-text body                                                                                               |
| `cc` / `bcc`        | same shape as `to`                            | no       | CC / BCC recipients                                                                                           |
| `attachments`       | array of absolute POSIX paths                 | no       | Files to attach (a leading `~` is expanded; files must exist)                                                 |
| `sender`            | email address                                 | no       | Account address to send from; defaults to Mail's default account                                              |
| `openComposeWindow` | boolean                                       | no       | Open the draft in a compose window and bring Mail to the front (default on); `false` saves silently to Drafts |

Example call:

```json
{
  "to": [{ "address": "someone@example.com", "name": "Someone" }],
  "subject": "Quarterly report",
  "body": "Hi,\n\nDraft attached.\n\nJason",
  "attachments": ["~/Documents/report.pdf"]
}
```

## Development

```sh
npm run dev          # run the server from source (tsx)
npm run check        # typecheck + lint + format check + tests
npm run test:watch   # vitest in watch mode
```

The AppleScript is generated from validated (zod) input, and every interpolated
value is escaped for AppleScript string literals, so recipient names, subjects
and bodies cannot break out into script code. Attachment paths are checked to
be existing regular files before any script runs.

## Known Mail quirks

- Mail silently drops attachments if a draft is saved in the same instant they
  are added, so the generated script waits one second before saving.
- After saving, the invisible compose session is closed (`close ... saving no`)
  so windows don't accumulate. Mail may still keep an inert entry in its
  scripting `outgoing messages` list until it is next restarted; this is
  harmless and invisible.
- Rich text (HTML) bodies are not supported in v1: Mail's AppleScript
  dictionary cannot set HTML content on an outgoing message, and the available
  workarounds require GUI scripting via the clipboard.
