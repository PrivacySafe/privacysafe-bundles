# What a sender, a backup file or a device can make this app do

[← back to the index](../README.md)

**State:** fixed on 2026-11-26. Prompted by a report against the chat app, where
any sender could forge a device-sync phantom. That hole is not here: a phantom is
applied only when its envelope sender is the user's own address
(`handleIncomingSyncEnvelope`), and every path to the sync engine goes through
that check. The audit then went over everything else a message, a backup archive
or another device of the user can feed into the app.
**Tests:** `tests/unit/src-deno/security-audit.spec.ts`, plus cases in
`handle-incoming-sync.spec.ts` and `html-to-text.spec.ts`.

## Threat model

The platform vouches for the sender of an ASMail message (`msg.sender`). The
subject, the bodies, `jsonBody` (`threadId` included), the recipients list and
attachment names are all written by the sender. A backup archive is a file the
user was handed; its metadata is not covered by the encryption's
authentication. Phantoms come only from the user's own address, so their bodies
are about buggy or older devices rather than attackers.

## Rules now enforced

| What | Rule | Where |
|---|---|---|
| List preview of an HTML body | parsed in an inert `DOMParser` document; an element of the window's document ran `<img onerror>` as soon as the list showed the mail | `src/common/utils/html-to-text.ts` |
| Report dialog and report body | quoted body sanitized like the reading view | `report-compose.vue`, `prepare-report-body.ts` |
| Confirmation dialogs | HTML sanitized, interpolated addresses escaped | `confirmation-dialog.vue`, `useContactBlocking.ts` |
| Reply and forward quotes | header fields escaped, body sanitized | `useCreateMsgActions.ts`, `sanitize-mail-html.ts` |
| Thread of an incoming mail | joins an existing thread only if its sender is already in it; otherwise `in-<msgId>`. A forward starts a new thread | `receive.ts` (`threadIdForIncoming`) |
| "To" of a received mail | shown as plain addresses, marked "as stated by the sender"; reply-all drops the user's own address in any spelling | `message-content-to.vue` |
| `replace` restore barrier | `snapshotTs` bounded by the newest stamp the archive carries and by the present | `inbox-backup-srv.ts` (`effectiveSnapshotTs`) |
| Archive entries | shape, tokens (plausible stamps), an address as the sender of an incoming record; `mode` only `merge`/`replace`; one bad folder does not abort a restore halfway | `inbox-backup-srv.ts`, `restore-snapshot.ts` |
| PBKDF2 iterations from an archive | at most 10 million | `backup-crypto.ts` |
| Test hook `handleIncomingSyncMsg` | exposed over IPC only on the test stand | `ipc-expose.ts` |
| Sync clock | follows only safe-integer stamps up to 7 days ahead | `dataset/index.ts` (`isPlausibleSyncStamp`) |
| Phantom bodies | known kinds checked for the fields they are read by; integer stamps | `mail-sync.types.ts` |
| Orphan buffer | one message per buffered entry (no N² growth), at most 20 000 entries | `orphan-buffer.ts` |
| Phantom sender | compared as an address, not as a string | `handle-incoming-sync.ts` |
| Received executables | confirmation before opening | `useOpenAttachments.ts`, `risky-file.ts` |
| Incoming fields | subject a bounded string, recipients a bounded list of strings | `transform-message.ts` |
| Log lines | one line each; quoted names cannot forge lines | `shared/utils/logger.ts` |
| Drafts from other apps | bounded recipients, files, sizes and pending drafts | `external-drafts.ts` |

## Not changed

- `ensureDefaultAnonSenderMaxMsgSize` raises the size limit for mail from
  strangers to the attachment limit at every start (`src-deno/index.ts`). This is
  a product decision about how much a stranger may send, not an input check.
- The address a report goes to is published by the reported sender's own domain.
  That is how the reporting protocol works.
- Another app of the same user could send a message of this app's `msgType` to
  the user's address. Whether the platform reserves `app:<domain>` for its app is
  a platform question.
- The pre-existing test environment issue: 18 component suites fail to load
  under vitest ("At least one `<template>` or `<script>` is required"), since the
  dependency update in `b1aba5b`.
