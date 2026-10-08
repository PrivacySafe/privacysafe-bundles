# Contact blocking

A blocked contact delivers nothing here and receives nothing from here. The decision itself belongs
to the **contacts app** — the flag lives there and is replicated between the user's devices from
there; this app only reads that list, acts on it, and offers a way to change it.

The same list is what `chat.app.privacysafe.io` acts on, and its
[doc/10-contact-blocking.md](../../chat.app.privacysafe.io/doc/10-contact-blocking.md) covers the
shared parts in more detail.

## 1. Where the list comes from

The flag is a contact's `settings.blockUser` in `contacts.app.privacysafe.io`, and that app exposes
three methods over `AppContacts`:

| Method | What it does |
|---|---|
| `getContactBlacklist(withImage?)` | the blocked contacts as of now |
| `changeContactBlockingSettings({id?, mail?, value})` | sets or clears the flag; **throws** for an address that is in no address book |
| `watchContactBlacklistChanging(obs)` | observable: the whole list on every change |

There are two readers here, and they are independent:

- the **Deno background component**, through `BlacklistTracker`
  ([contacts-blacklist.ts](../src-deno/services/contacts-service/contacts-blacklist.ts)) — it needs
  an `otherAppsRPC` capability of its own, and the one in
  [manifest.json](../manifest.json) for `/background-instance.mjs` was added for it;
- the **window**, through the contacts store
  ([contacts.store.ts](../src/common/store/contacts.store.ts)), for what it draws.

Neither goes through the other. The filter on incoming mail has to work while no window is open —
the background component starts with the system — and the window has to draw marks before the
contacts app is reachable.

## 2. BlacklistTracker

### 2.1 Warm start

The set of blocked addresses is filled **synchronously, before any RPC**, from a cache in SQLite
([contacts-blacklist.ts:48](../src-deno/services/contacts-service/contacts-blacklist.ts#L48)).
Reaching the contacts app takes up to three attempts with `3s / 10s / 30s` between them, while the
catch-up scan of the inbox starts at once — so without a cache, mail from a blocked sender that
arrived while the device was off would be stored and announced before the tracker knew anything.

The cache is a table of its own, `contact_blacklist`, and not a field of `AppState`: that one is a
JSON blob its callers rewrite whole, and it travels to the window in `app-state` events, where
another app's cache has no business. The same reasoning is already written out over `sync_device`
([dataset/index.ts](../src-deno/dataset/index.ts)).

### 2.2 What this app does NOT keep from chat's version

Chat's tracker computes a delta of the list (`added` / `removed`) and holds a baseline flag so that
the first list after a cold start is not read as "everybody was just blocked". That machinery exists
there to write system records into chat histories. This app writes none, so the tracker keeps only
the warm start, and `getCachedBlacklist()` returns `string[]` rather than `string[] | undefined`:
"nobody is blocked" and "we have not looked yet" lead to the same behaviour here.

## 3. What is filtered on the way in

Mail from a blocked sender is not stored at all — it is taken off the server instead:
[route-incoming.ts](../src-deno/services/mail-service/route-incoming.ts), inside the branch for
`msgType === 'mail'`.

Being **inside that branch** is what keeps synchronization safe. A sync phantom comes from this very
user's own address, and losing one costs this device a change made on another. Chat achieves the
same with a `!areAddressesEqual(sender, ownAddr)` check paired to every blacklist check in four
places; here the structure of the router gives it for nothing, and the own-address check is kept
only as a second line for a future caller.

The message counts as **handled**, so the watermark moves past it. Answering "not handled" would
hold the watermark and make every later scan re-list a message that is no longer on the server.

Removal is immediate — `w3n.mail.inbox.removeMsg`, with a retry scheduled as already-due if the
server cannot be reached
([mail-service.ts](../src-deno/services/mail-service/mail-service.ts)). That is this app's standing
rule rather than a decision taken here: an ordinary message leaves the server at once, and only
phantoms wait (see [multi-device-sync.md](./multi-device-sync.md)). Nothing is lost for the user's
other devices — they read the same list and would drop the same message.

### 3.1 Mail received before the blocking is never touched

The filter asks `db.getMessageById(msgId)` first, and leaves anything already stored alone.

This is not a formality. A restore rewinds the watermark to 0 and asks for a pass over the whole
inbox, so the scan comes back round to mail received long before the blocking; without the check,
that mail would be taken off the server although the user never deleted it.

The promise is the same in the window: mail from a blocked sender stays, carries a lock, can be
forwarded and can be deleted — deletion being the user's own action, as it is for any other message.

## 4. What is filtered on the way out

The window keeps blocked addresses out of the recipients (§6.3), and the background component
refuses a message that names one anyway
([inbox-service.ts](../src-deno/services/inbox-service/inbox-service.ts), `sendMessage`).

Chat needed a single choke point on `delivery.addMsg` because it collects recipients in some twenty
places. This app calls `addMsg` exactly once and sends only what the user composed, so the backstop
is there for a different reason: **the window's ban is bypassable.** A draft saved before the
blocking and sent afterwards from Outbox goes by the recipients stored in the record, never passing
the form again; and a blocking made on another device reaches this component before it reaches the
window.

It **refuses** rather than quietly dropping the blocked addresses: `outcomeOf()` counts a delivery's
result against `message.recipients`, so a partial send would leave the record claiming a recipient
nothing was ever sent to.

## 5. Interface

Everything below lives in `src/common/`, so both form factors get the same.

### 5.1 Doing it

| What | Where |
|---|---|
| the **Manage blocks** menu item, first in the avatar menu | [useAppMenu.ts](../src/common/composables/useAppMenu.ts) |
| the dialog it opens | [manage-blocks-dialog/](../src/common/components/dialogs/manage-blocks-dialog/) |
| **Block** / **Unblock** on an open message | [message-content-header.vue](../src/common/components/message-content/message-content-header.vue), [message-toolbar-main.vue](../src/mobile/components/message-toolbar/message-toolbar-main.vue) |
| the act itself: confirm → change → report a failure | [useContactBlocking.ts](../src/common/composables/useContactBlocking.ts) |
| reaching the contacts app | [contacts.store.ts](../src/common/store/contacts.store.ts) |

The item is drawn in the warning colour (`--warning-content-default`), as the same action is in
chat: it is about a person, not about this app's own data.

**The buttons on a message go through `MessageAction`**, as every other button of those two
toolbars does, and `handleMessageAction` ([useFolderContent.ts](../src/common/composables/useFolderContent.ts))
is where they meet `runContactBlocking`. Only one of the pair is ever drawn, off the same
`isBlacklisted` the lock beside the address is drawn off, and the pair is offered only where
blocking means anything: the message is incoming **and** its sender is not this user. An address
of one's own arrives on a copy of a sync phantom, and blocking it would stop this mailbox's own
traffic — so the check is made again in the dispatcher, for the same reason Reply is refused
there as well as hidden. On the mobile page the action does not navigate away
([message.vue](../src/mobile/pages/message/message.vue)): blocking changes what that very page
draws.

**The dialog lists more than the address book.** Blocking is not a privilege of contacts — most of
what one wants to block was never added to one — so it shows every contact **and** every address met
in a message, over all folders including the trash
([blockable-addresses.ts](../src/common/utils/blockable-addresses.ts)). The user's own address is
left out, and an address that is also a contact is listed once.

**A contact is made when there is none.** `changeContactBlockingSettings` throws for an address in
no address book, so blocking creates the contact first. `upsertContact` is used for that, and
deliberately not `addContact()` from the same store: that one fetches the list to check for a
duplicate, which is right when a user is adding somebody to write to and beside the point here.

The dialog does not close when a row's button is pressed: the confirmation is a dialog of its own,
and the plugin holds a stack and closes only the one whose `action` fired. The rows emit no `action`
at all, so the window survives any number of blockings in a row.

### 5.2 Marks

| What | Where |
|---|---|
| `round-lock` over the sender's avatar | [message-list-item.vue](../src/common/components/message-list-item/message-list-item.vue), [thread-list-item-multiple.vue](../src/common/components/thread-list-item/thread-list-item-multiple.vue) |
| `round-lock` beside the address in an open message | [message-content-from.vue](../src/common/components/message-content/message-content-from.vue) |

One rule everywhere: the message is incoming **and** its sender is on the list. Mail already
received is marked rather than hidden — it is the user's, and only they remove it.

In an open message from a blocked sender, "add to contacts" is no longer offered either: blocking
has made the contact already.

### 5.3 What is refused

- **Reply and Reply All**, in both form factors
  ([message-content-header.vue](../src/common/components/message-content/message-content-header.vue),
  [message-toolbar-main.vue](../src/mobile/components/message-toolbar/message-toolbar-main.vue)) —
  and again in `handleMessageAction`
  ([useFolderContent.ts](../src/common/composables/useFolderContent.ts)), because a hidden button is
  not a ban: it is drawn off a list another app changes under it.

  **Forward is not refused**, and neither is deleting. Forwarding is writing to somebody else, and
  whether a message is worth passing on to an address that is not blocked is the user's call.

- **A blocked contact cannot be picked** as a recipient. It is kept out of the autocomplete's items
  rather than shown disabled, because `Ui3nAutocomplete` has no per-item disabled state and anything
  it lists can be clicked. Why it is missing is explained where it belongs: the lock on their mail,
  and the Manage blocks list.

- **A blocked address typed by hand** is taken out of the recipients, with a notice naming it
  ([useCreateMsg.ts](../src/common/components/dialogs/create-msg-dialog/useCreateMsg.ts)). Removing
  it silently would read as swallowed input. The same check runs when the list changes while the
  form is open, and again before a send.

- **Pre-flight does not ask the server** about a blocked address
  ([useCreateMsgActions.ts](../src/common/composables/useCreateMsgActions.ts)): it is reported as
  unavailable with a reason of its own, which the existing "send to the available ones" logic
  already drops.

## 6. Tests

Unit tests cover the router's decision, the tracker's warm start, the store, the collection of
addresses for the dialog, and every refusal in the interface.

The app tests ([contact-blocking.ts](../tests/app/src/tests/contact-blocking.ts)) run against the
real contacts app, which is why it is now listed in
[test-setup.json](../tests/app/test-setup.json) — with `skipAutoLaunch`, since this app reaches it
over RPC rather than opening it. They check the round trip through the contacts app, that the
background component ends up with the same list, that a send to a blocked address is refused, and
that mail received before a blocking stays both in the database and on the server.

## 7. What is not here

- **No server-side blocking.** The platform does offer one — `w3n.mail.config`, the
  `auth-sender/blacklist` parameter and `applyBlackList` in `auth-sender/policy` — and this app has
  the capability for it. It is not used: it covers only senders authenticated to the server, saying
  nothing about anonymous ones; the list is replaced whole on every change, which races between
  devices; and it would take blocking out of the one place that owns it, the contacts app.
- **No history of blockings.** Chat writes a system record into every chat with that contact. There
  is no such place in a mailbox, and a message cannot be inserted into a thread that the sender did
  not send.
- **One language only.** The dictionary is English (`en.ts`), as is the rest of the interface. The
  wording of the confirmations is taken from chat.app word for word, so that two apps do not
  describe the same act differently.

---

Back to [the index](./README.md).
