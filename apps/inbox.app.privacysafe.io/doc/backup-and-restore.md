# Backup and restore

The app's data lives in the **local** file system of each device
([`storage-db`](../src-deno/dataset), and `mail-app-files` beside it), and the
devices converge through phantom ASMail messages
([multi-device-sync.md](./multi-device-sync.md)). Both halves of that shape
decide what a backup here can be.

Contacts keeps its whole database in synced 3N storage, so a restore there is a
dump of one file republished to the server in one pass. Nothing of that carries
over. Here a restore lands on ONE device whose neighbours know nothing about it,
and the app has no re-synchronization protocol to fall back on — a device
restored from an archive would otherwise diverge from the rest for good.

Hence the one idea everything below follows from:

> **A restore invents no merge rules of its own. It is expressed in the ones
> that already exist.**

An archive stores records together with their per-aspect ordering tokens; a
restore applies them through `applyIfNewer()`; the other devices are told about
it by a bulk phantom carrying the same tokens, and the receiver applies them
through the same `applyIfNewer()`. `applyRestoreSnapshot()` in
[restore-snapshot.ts](../src-deno/services/sync/restore-snapshot.ts) is literally
one function used by both ends — which is the only real guarantee that `merge` on
a neighbour means what `merge` meant on the source.

## The division of labour

Same as in Contacts, and for the same reason: on Android a `runtime: "deno"`
component is executed by `androidx.javascriptengine` — a bare V8 isolate with no
Web APIs, where `crypto` is simply absent. The GUI has WebCrypto on both
platforms.

| Layer | Owns |
|---|---|
| deno service ([inbox-backup-srv.ts](../src-deno/inbox-backup-srv.ts)) | the database and the file store, packing and unpacking the inner zip, applying a restore, announcing the snapshot |
| GUI ([backup-container.ts](../src/common/utils/backup-container.ts), [backup.store.ts](../src/common/store/backup.store.ts)) | the container, the metadata of an encrypted archive, encryption, the file dialogs |

**The passphrase never crosses the IPC.** The service is handed an archive that
is already decrypted.

One constraint is peculiar to this app: the manifest gives the GUI
`shell.fileDialog` and **no** `storage`, and the deno component the other way
round. So the bytes of the archive travel over the IPC. To keep that from blowing
up on a mailbox with gigabytes of attachments there is a fuse,
`BACKUP_MAX_BYTES` (1 GB): the size is estimated **before** anything is packed,
and an oversized mailbox is refused with `archive_too_large` and the way out —
take the backup without attachments. Streaming straight into a `WritableFile` is
out of scope (§ *Deliberately out of scope*).

## The format

### File name

```
inbox-backup-0_3_41-2026-09-06_18-20.zip
```

Dots in the version are replaced rather than kept: `inbox-backup-0.3.41-…` reads
as an archive with a `.41-…` extension to file dialogs and unpackers alike.

### Unencrypted

```
inbox-backup-<version>-<stamp>.zip
├── inbox_app_privacysafe_io.json   # metadata
├── messages.json                   # records + their per-aspect tokens
├── folders.json                    # folders + tokens
├── tombstones.json                 # the tombstone rows of sync_versions
└── attachments/<blobName>          # bytes out of mail-app-files, not recompressed
```

### Encrypted

The outer zip holds exactly two entries: the metadata in the clear, and
`payload.zip.enc` — the ciphertext of the inner zip, stored rather than deflated
(ciphertext does not compress). The inner zip is the same set **without** the
metadata file.

The counts (`messagesCount`, `attachmentsCount`) are left out of an encrypted
archive's metadata: the size of a mailbox is not worth disclosing to somebody who
cannot open the archive anyway. `snapshotTs` is **not** left out, and cannot be —
see below.

PBKDF2-HMAC-SHA-256 at 250 000 iterations, AES-GCM-256, salt and iv fresh per
archive. A forgotten passphrase has no recovery path, by construction.

### `snapshotTs`

The hybrid-logical-clock stamp taken by `db.nextSyncToken().ts` at the moment the
archive is built. It is the barrier of the `replace` mode: "a local entity older
than the archive" means exactly *its greatest stamp is below `snapshotTs`*.

Calendar `createdAt` cannot serve for that — tokens live on the HLC scale, which
runs ahead of `Date.now()` as soon as two devices' clocks disagree. This is why
the GUI carries `snapshotTs` into the container of an **encrypted** archive: the
inner zip has no metadata, and without the stamp a restore would have no barrier
at all.

### Records

```ts
interface BackedUpMsg {
  msgId: string;
  incoming: boolean;
  /** The part shared with a phantom; built by syncedRecordOf(). */
  record: SyncedMsgRecord;
  /** record.attachmentsInfo is IGNORED on restore in favour of this. */
  attachments?: BackedUpAttachment[];
  versions: Partial<Record<SyncAspect, SyncToken>>;
}
```

**Incoming records go into the archive whole**, on the same footing as outgoing
ones: bodies, sender, `threadId` and the read state. This is where an archive
differs from a phantom, which never carries an incoming record — and the
difference is about the CARRIER. A phantom's carrier is known to be alive (the
message itself, in the shared inbox, which every device of the user can read); an
archive has no such guarantee. The message can be deleted from the server any
time after the backup, and then the archive is its **only** carrier.

That is what `incomingMsgFromSyncedRecord()` in
[record-mapping.ts](../src-deno/services/sync/record-mapping.ts) exists for — the
pair of `msgFromSyncedRecord()`, which only ever had to build an
`OutgoingMessageView` because incoming records never went over the wire.

Attachments are a **field of their own**, not part of `record`, and that is not
cosmetic. `attachmentsForPhantom()` deliberately cuts `id` out and marks the
record `hasNoLocalSource`, because an id points into another device's file store
and can *collide* with a local one. An archive needs the opposite — the link
between a record and its bytes — so keeping the two apart is what lets
`syncedRecordOf()` be reused unchanged.

### What of the mailbox is left out of the archive

| Left out | `reason` | Why |
|---|---|---|
| a file attached on **another device of the user** | `on-another-device` | file bytes never travel between devices, so there is nothing here to put in |
| the user asked for an archive without attachments | `not-requested` | the way out of `archive_too_large` |
| `external` attachments (symlinks to the user's own files) | `external` | the archive never owned those bytes, and they are exactly the files too big to be worth duplicating |
| `origin` attachments of incoming messages | `origin` | they live inside the message on the server and survive a restore as long as the message does |
| an attachment whose file cannot be read | `unreadable` | one unreadable file must not fail a whole backup |
| no readable file and no marking saying why | `no-local-source` | should not happen |

Every one of these goes into `skippedAttachments` in the metadata, so a message
without a file afterwards is explainable.

**`on-another-device` is the first row for a reason.** With several devices it is
the ordinary case, not the rare one: **an archive is only ever as complete as the
device it is taken on.** A live run made that plain the hard way — a mailbox whose
whole archive held `attachmentsCount: 0`, because the files had been attached
elsewhere, and the only way to learn why was to unpack the file and read this
field by hand.

So the reasons are counted and named apart, in three places
([skipped-attachments.ts](../src/common/utils/skipped-attachments.ts) holds the
one set of lines):

- **before** a backup, as a standing line in the creation dialog
  (`backup.create.thisDeviceNotice`): only files on this device go in;
- **after** it, as a `warning` notice broken down by reason rather than a count;
- **before a restore**, in the mode dialog, out of the archive's own metadata —
  this is the one thing a restore cannot bring back, and learning it afterwards
  is learning it too late.

It is told apart from `no-local-source` because it is the only one of these the
user can act on: take the backup where the files are.

**Each row is a reason of its own, and that is the lesson of how this was
found.** `attachmentsCount: 0` came back from three live runs in a row, and each
time the verdict was too coarse to say why: first `no-local-source` stood for
both "the record has no id" and "you did not ask for the bytes", so the search
went after the records — which were sound. What settled it was the archive
describing its own decision: `skippedAttachments` now carries the record as it
stood (`hasId`, `type`, `external`, `hasNoLocalSource`, `hasOriginMsgId`)
alongside the reason, so a metadata file answers "why is this file not here"
without anybody unpacking `messages.json` or reading a log.

The cause, once visible, was in the GUI and nowhere near the archive:
`withAttachments?: boolean` on the creation dialog compiles to
`{ type: Boolean, required: false }`, and **Vue casts an absent Boolean prop to
`false`, not to `undefined`** — so every ordinary backup, which opens that dialog
without the prop, was asking for an archive with no attachment bytes. It is
pinned down by
`tests/unit/src/common/components/backup-creating-dialog.spec.ts`, which asserts
both the explicit default and the casting itself.

**The one the user has to be told about at backup time** is the second: the bytes
of a received message's attachments are on the server, and deleting that message
there loses them for good — while the message itself, headers and body, restores
in full out of the archive. The dialog for creating a backup carries a permanent
line to that effect (`backup.create.attachmentsNotice`). It is an explanation and
not a warning to confirm: it is not about the risk of this particular action but
about the boundary of what an archive can ever bring back, and that is worth
knowing six months before it matters.

## Restoring: two modes

The user picks one, and it is applied by one function with a branch — so that
what happens on the restoring device and on every other one is literally the same
code.

### `replace` — the archive states what the mailbox is

- for every entity of the archive, each aspect through `applyIfNewer()` with the
  **archived** token. A newer local change survives — that is word for word
  "whatever is younger than the archive stays as it is";
- the ordinary `isDeletedLaterThan()` guard holds: a tombstone younger than the
  archived record does not let it come back;
- local entities the archive does **not** have, and whose greatest stamp is below
  `snapshotTs`, are deleted through `deleteMessagesWithGc()` under one **fresh**
  token. Fresh, not archived, because the deletion has to win on the receiving
  devices;
- system folders are never in that list.

The "greatest stamp" is not the aspect tokens alone, and the reason is worth
spelling out: an incoming message that was never marked read and never moved has
NO tokens at all, so by tokens alone every message that arrived **after** the
backup would read as older than it and be deleted. Its own `deliveryTS` (or a
draft's `cTime`) stands in — see `ageStampOf()` and `surplusOfArchive()`.

### `merge` — fill in what is missing

- an entity that is here → **not touched at all**, in any aspect;
- an entity with a tombstone → skipped, whatever the stamps say. `merge` never
  resurrects;
- otherwise created, with its `sync_versions` filled from the archive so that
  later last-write-wins works;
- nothing is deleted.

### One listing of the shared inbox

Before anything is applied, a restore makes **one**
`w3n.mail.inbox.listMsgs(INBOX_SCAN_FLOOR_MS)` and builds the set of msgIds
really present in the shared inbox. It is the same call the catch-up scan makes at
every start, so it adds no new class of load. The floor is obligatory: with a
falsy `fromTS` the platform's inbox index throws ENOENT instead of listing
(see [sync.ts](../shared/constants/sync.ts)).

One set answers three questions:

1. **what goes into the snapshot** — the main consumer, see below;
2. **whether `origin` attachments are reachable.** A message that is not on the
   server has its attachments nowhere: they lived inside it. Restoring them as
   `type: 'origin'` would show the user a file that can never be opened;
3. **how much of the restored mail only the archive carries** — diagnostics.

The archive's records are **not** filtered by that set. An incoming message is
restored either way. Filtering would be worse on three counts: a restore would
stop working offline; mail would appear gradually as a big mailbox was scanned
rather than at once; and the read state and the folder would come from the archive
regardless, so the saving would amount to message bodies. No divergence follows:
a msgId is issued by the server once, so a record derived again by a catch-up scan
is an `updateMessage()` under the same key, not a second message.

**A failed listing gives an EMPTY set**, and that is the safe side of the
failure: the snapshot then carries the records of every incoming message
(redundant but harmless — on the receiver an archived token loses to a fresher
one), and `origin` attachments stay marked reachable, which is exactly how the app
behaves today.

### What synchronization already restores, and what only the archive can

Worth knowing before reaching for a backup at all: **a device that lost its
database recovers every RECORD from the shared inbox on its own**, as long as the
change is inside the synchronization window. The phantoms of the user's own
changes sit in that inbox for `INBOX_REMOVAL_DELAY_MS` (15 days), and to a
device with a new `appDeviceId` they are another device's phantoms — so they
apply. Drafts, sent mail and the placement of received mail all come back
without any archive.

What that cannot bring back is the **bytes** of attachments: a phantom carries
the record marked `hasNoLocalSource` and nothing else. Those, and records whose
phantoms have aged out of the window, are the archive's own contribution.

Which is why filling in attachment bytes stands **outside the aspect rules**
(`fillInAttachmentBytes()` in
[restore-snapshot.ts](../src-deno/services/sync/restore-snapshot.ts)). Applied to
bytes, those rules produce a restore that restores nothing in exactly this case:
`merge` skips a record that is present, and `replace` finds the archive's
`content` token **equal** to the stored one — one stamp goes into
`sync_versions` and into the phantom alike (see `announce()`), so the archived
token loses in `isNewerToken()`.

So availability is not treated as an aspect, and it should not be: an aspect is
something two devices can disagree about, and no other device can claim that the
bytes are not on **this** one. Filling them in only ever adds — a file the user
could not open becomes one they can — so there is nothing for last-write-wins to
arbitrate and no token to write. It happens in **both** modes; `merge`'s promise
is that it touches no *aspect*, not that it withholds bytes nothing else can
supply. Availability is decided per attachment, so the merge is per attachment
too: one whose file is readable is left exactly as it is.

### Attachments on restore

For every `blobName` the bytes go into the store through
`fileStore.addBytes(...)`, which gives a **new local id** — the archived id is
never reused, because an id points into the store of whatever device made the
backup and can collide with a local one.

`addBytes` rather than `addBlob`, and for the same reason `crypto` lives in the
GUI: `Blob` is a Web API, and the bare V8 isolate on Android has none.

An attachment with no bytes in the archive is restored either as `type: 'origin'`
(when the message that holds it is in the shared inbox) or as a record without an
`id` and marked `hasNoLocalSource`, which
[attachment-availability.ts](../shared/utils/attachment-availability.ts) already
renders as "the file is not here" instead of a link that leads nowhere.

### What is never restored

This is the reason an archive holds a logical export and not a dump of the
`storage-db` file.

| Never restored | Why |
|---|---|
| `sync_device.appDeviceId` | two devices with one id stop seeing each other's phantoms — each takes them for its own echo — and the LWW tie-break breaks with them. The restoring device keeps its own id |
| `AppState.lastReceivingTimestamp` | this device's watermark over the SHARED inbox. Somebody else's watermark, from the future, would make the device skip the whole catch-up scan and lose incoming mail. Reset to 0 |
| `pending_sync_msgs`, `orphaned_syncs`, `pending_inbox_removals` | the state of one device's own processes |
| `thumbnails` | a local cache that rebuilds itself in milliseconds |

### Holding off the background tracts

A restore rewrites what receiving mail writes. Instead of a lock of its own it
uses the mechanism already there: while `db.isRestoreInProgress()` is true,
`handleOne()` in
[mail-service.ts](../src-deno/services/mail-service/mail-service.ts) counts an
incoming message as **not handled** — the watermark does not advance and the id is
not marked as seen — so the pass right after the restore takes it on again. That
pass is `mailService().catchUp()`, called by the restore itself: the watermark was
reset to 0 precisely so the pass covers the whole inbox, and without it the
mailbox would only come back in full at the next start of the component.

Three things about that pass, and each of them was a real defect first:

- **it is not awaited.** `restoreBackupArchive()` returns as soon as the archive
  is applied. The pass is a listing of the whole inbox and a walk over it, and
  the caller has no business waiting for that — the restore's own outcome is
  already final. Awaiting it made every restore spec time out on jasmine's
  default limit, and would have held the GUI for as long as the scan took;
- **it does not clear the set of ids handled this session.** A message this
  session already handled needs nothing done to it — its record is in the
  database, and neither mode rewrites the content of an incoming record that is
  there. Clearing the set would re-fetch every message of the mailbox: minutes of
  network for no change;
- **it fetches inside the same per-message proc as the live subscription.**
  Two concurrent `getMsg` calls for one message make the platform's own inbox
  cache throw `EEXIST` over the file it is writing. This could not happen while a
  pass only ever ran at startup; making one callable is what exposed it. The
  passes themselves are serialized against each other too.

The whole restore is bracketed with `beginBulkReplay()` / `endBulkReplay()`, so
the GUI gets one `{ entity: 'lists', event: 'reload' }` instead of watching every
row walk through its history. The `backup` and `restore` progress events are
deliberately outside `COALESCED_ENTITIES`: a restore opens that window, and its
own progress must not be what the window swallows.

### The catch-up scan must not undo the restore

`persistIncomingMail()` in
[receive.ts](../src-deno/services/inbox-service/utils/receive.ts) keeps the
`status` and the `mailFolder` of an existing record instead of taking the ones a
fresh derivation invents (`incomingMsgToIncomingMsgView()` always answers
`received` and Inbox). Those two columns carry the aspects that belong to the
USER rather than to the server, and a re-derivation is not entitled to speak for
them.

This is a latent defect without backups at all — it shows in the
`CATCH_UP_REWIND_MS` window on a message read just before the app closed — and a
restore turns it from rare into certain: the watermark reset makes the scan walk
every restored incoming message. Its spec is
`tests/unit/src-deno/services/inbox-service/utils/receive.spec.ts`.

## Telling the other devices: the v2 phantom

### Why `v: 2`

Chosen deliberately. A build that predates it does not recognize the body, and
the branch for that is already written: such a message is left alone and only
scheduled for a **deferred** removal (15 days) rather than taken out of the
shared inbox at once — precisely the case the comment in
[handle-incoming-sync.ts](../src-deno/services/sync/handle-incoming-sync.ts)
describes.

```ts
export type MailSyncEventV2 = {
  kind: 'restore-snapshot';
  mode: 'replace' | 'merge';   // the receiver applies the same rule
  snapshotTs: number;
  restoreId: string;
  part: number;
  of: number;
  msgs?: SnapshotMsgEntry[];
  folders?: SnapshotFolderEntry[];
  /** Only in `replace`, and only in the last chunk. A FRESH token. */
  deleted?: { msgIds?: string[]; folderIds?: string[]; token: SyncToken };
};
```

### The rule of the carrier

An ordinary `msg-record` phantom never carries an incoming record, and that is
right: the carrier of such a record is the message itself in the **shared**
inbox, which the receiving device reads with one
`w3n.mail.inbox.getMsg(msgId)`. Duplicating the bytes would be pointless.

**For a snapshot that stops being true, and here is where.** The user takes the
archive, then deletes an incoming message from the server. On the restored device
the message is back — it came out of the archive. On a neighbour it is not, and
there is nothing to get it from: `getMsg` refuses, `ensureRecordFor()` puts the
entry in the orphan buffer, and `ORPHAN_TTL_MS` (15 days) later the collector
throws it away. The devices would differ for good, and no later pass would put
that right.

So the rule is stated through the carrier and not through the direction of the
message:

> A record travels in a snapshot when, and only when, the receiver has no other
> way of getting it.

An incoming message that IS in the shared inbox travels as
`{ msgId, incoming: true, read?, placement?, versions }`: the receiver reads the
body itself, and takes from the snapshot what the server does not know — whether
the user read it and where they put it. An incoming message that is **not** on
the server travels with its full `record` and the flag `noServerCopy`.

`noServerCopy` changes one branch on the receiver: no `getMsg`, no buffering, the
record is built from what the entry carries. Without the flag the receiver would
spend a network call on a message that is known not to be there and — worse — on
its refusal would bury the entry in the orphan buffer, where it would die of old
age with the record sitting right beside it in the same chunk.

The attachments of such a record are marked `hasNoLocalSource` before they
travel. An `origin` attachment is the one case `attachmentsForPhantom()`
deliberately leaves unmarked, because its bytes are in the shared inbox — and for
a message no longer in that inbox the premise is gone with it.

### Volume

In the ordinary case the snapshot is the number of **outgoing messages and
drafts** plus a handful of incoming ones deleted from the server since the
backup — an order of magnitude smaller than the mailbox. The worst case (the user
cleared the server out) is bounded from above by the size of the archive, and that
is bounded by `BACKUP_MAX_BYTES`; bodies without attachments are cut into chunks
of `RESTORE_SNAPSHOT_CHUNK_BYTES` = 192 KB, so what grows is the number of
deliveries and not the size of one message.

A restore is announced whether or not this device has ever seen a phantom from
another one. `hasSeenOtherDevice()` answers "has a neighbour ever spoken here",
not "is there a neighbour": a device switched off since the app was installed
would otherwise be left behind for good. What that costs a single-device user is
records without attachment bytes in their own inbox, collected after
`INBOX_REMOVAL_DELAY_MS`.

### Into the journal

`announceSnapshotChunk()` in
[sync-outbox.ts](../src-deno/services/sync/sync-outbox.ts) writes a journal row
**without** touching `sync_versions`: the aspect tokens a snapshot carries are the
archived ones, and the restore has already written them.

The row is described as `entityType: 'restore'`,
`entityId: '<restoreId>#<part>'`, `aspect: 'snapshot'`. The unique id per part
means no two rows ever share an (entity, aspect) pair, so `isSupersedable()` in
[phantom-flight.ts](../src-deno/services/sync/phantom-flight.ts) can never drop a
chunk in favour of a "newer" one; `'snapshot'` is outside
`SUPERSEDABLE_ASPECTS` as well, which says the same thing a second time on
purpose. `'restore'` is never written into `sync_versions`.

The journal gives a snapshot what it gives any change: a chunk that could not go
out because the server was unreachable is picked up by the next pass, including
the one after a restart.

### Order does not matter

The proof is short: the entries of different chunks do not overlap, and the
deletion token is fresh — greater than any archived token — so the deletion wins
whenever it arrives. A chunk delivered twice is harmless for the general reason:
an equal token loses in `isNewerToken()`.

## A known limitation

A message deleted on another device longer than `TOMBSTONE_TTL_MS` (16 days) ago,
whose tombstone has already been collected, **will be resurrected** by a snapshot
in `merge` mode. This is not fixable for any restore: nothing left anywhere says
the message was deleted rather than never received.

## Verification

Unit specs (`vitest`, two projects — `node` for `src-deno`/`shared`, `dom` for
`src`):

| Spec | Covers |
|---|---|
| `tests/unit/src-deno/utils/backup-archive.spec.ts` | the file name, path safety (`../`, `__MACOSX/`, `.DS_Store`), a foreign app's metadata, the shape of the metadata |
| `tests/unit/src-deno/utils/check-backup-version.spec.ts` | compatibility by `formatVersion` |
| `tests/unit/src-deno/inbox-backup-srv.spec.ts` | what goes into an archive and what does not, with the reason for each; one unreadable file not failing the backup; `archive_too_large`; the metadata the GUI has to encrypt around |
| `tests/unit/src/common/utils/skipped-attachments.spec.ts` | the reasons counted and named apart, and a key in `en.ts` for every one of them |
| `tests/unit/src/common/utils/backup-crypto.spec.ts` | the round trip, a wrong passphrase, salt and iv never repeating |
| `tests/unit/src-deno/services/sync/restore-snapshot.spec.ts` | chunking; both modes; tombstones in `merge`; deletion in `replace`; a chunk applied twice; the rule of the carrier; what is never restored |
| `tests/unit/src-deno/services/inbox-service/utils/receive.spec.ts` | `persistIncomingMail()` keeping `status` and `mailFolder` — i.e. the full catch-up scan after a restore not resetting "read" and the folders |
| `tests/unit/src/common/store/backup.store.spec.ts` | what exactly reaches the file — the container, not the inner zip |
| `tests/unit/src/common/composables/useBackupRestore.spec.ts` | the restore flow over real archives, a retried passphrase |

The store and composable specs build real zips and run real PBKDF2, which is why
those cases carry a raised timeout.

App-level: `tests/app/src/tests/backup-restore.ts`, on the pattern of
`sync-conflicts.ts` — real archives and synthetic phantom envelopes against the
live service. It walks the whole circle: take an archive → restore it → apply the
snapshot as a neighbour would, in both modes.

By hand on two devices: `run-test-mac.sh` and `run-test-mac2.sh` (the second
starts the same user in a data folder of its own). Take an archive on A → change
messages on B → restore on A in each mode → check that B converges with A by the
rules, and that A's log holds no `error` line about an undelivered phantom.

**One trap in doing that by hand**, and it cost a whole live run: wiping a
device's data folder does **not** give a state that needs the archive. Such a
device resyncs every record from the shared inbox (see above), so a restore over
it correctly finds nothing to do beyond the attachment bytes. To watch a restore
actually rebuild a mailbox, restore an archive of one user into **another
account** — nothing is there and no phantom in that inbox is about those records,
so everything comes from the archive.

## Deliberately out of scope

- **Streaming the archive straight into a `WritableFile`.** It would lift the
  memory limit, but it rules out encrypting in the GUI (AES-GCM needs the whole
  buffer) and splits the saving path in two. For now: the `BACKUP_MAX_BYTES` fuse
  and the "without attachments" way out.
- **The bytes of `origin` attachments of incoming messages.** They are on the
  server and survive a restore as long as the message does. Once the message is
  deleted there they are lost for good — a restore marks them
  `hasNoLocalSource` honestly but cannot bring them back. The only way to close
  that would be to pull them into the archive at backup time, which was rejected
  on the weight of the archive. **The bodies and headers of such messages do
  restore in full** — the archive carries those. The user is told so plainly in
  the dialog for creating a backup.
- **Restoring `thumbnails`.** A cache that rebuilds itself.
- **Incremental and scheduled backups.**
