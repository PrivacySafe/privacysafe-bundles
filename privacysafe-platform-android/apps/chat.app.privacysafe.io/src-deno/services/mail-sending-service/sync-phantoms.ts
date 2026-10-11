/*
 Copyright (C) 2026 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

/**
 * Sync phantoms: messages a device sends to itself, so that the user's other
 * devices learn about a change made here.
 *
 * Sending one is two steps, and they are deliberately apart:
 *
 *  - a phantom is *built* by one of the make*Phantom() functions below and
 *    written into the journal together with the ordering tokens of the change
 *    it announces (queueSyncPhantom(), one database operation);
 *  - it is *released* to delivery by a pass over the journal, which clears a
 *    row once delivery has accepted the message.
 *
 * The reason for the journal is that a change's ordering token is spent the
 * moment the change is applied: if the phantom is then lost - the component is
 * closed, delivery is unavailable - nothing ever re-sends it, and the other
 * devices never learn about the change. With the journal, an unreleased phantom
 * is picked up by the next pass, including the one at startup.
 */

import { SingleProc } from '../../../shared-libs/processes/single.ts';
import { sleep } from '../../../shared-libs/processes/sleep.ts';
import { makeLogger } from '../../../shared-libs/logger.ts';
import { PHANTOM_FLIGHT_GRACE_MS, PHANTOM_SEND_SPACING_MS } from '../../../shared-libs/constants/index.ts';
import { addMessageToDeliveryList, newSyncPhantomDeliveryId } from './sending-primitives.ts';
import {
  countFlightsAwaitingOutcome,
  countFlights,
  currentFlights,
  describeDeliveryErrors,
  describeJournalRow,
  flightsToForget,
  forgetFlightOfRow,
  isTerminalDeliveryFailure,
  notePhantomHandedToDelivery,
  partitionByFlight,
  takeFlightOfDelivery,
} from './phantom-flight.ts';
import {
  createSyncMsgBasedOnInvitationMsg,
  createSyncMsgBasedOnSystemMsg,
} from '../chat-service/utils/_msgs-related-methods.ts';
import { syncPassOutcome, type SyncPassOutcome } from '../../utils/sync-activity.ts';
import type {
  AcceptedMsgBodySysMsgData,
  ChatIdObj,
  ChatInvitationMsgV1,
  ChatOutgoingMessage,
  ChatSyncMsgV1,
  ChatSystemMsgV1,
  DeleteMessageSysMsgData,
  LocalMetadataInDelivery,
  MemberRemovalSysMsgData,
  PhantomSyncMsgDataBasedOnRegularMsgV1,
  UpdatedMsgStatusSysMsgData,
} from '../../../types/index.ts';
import type {
  DB,
  MsgDbEntry,
  PendingSyncMsgDbEntry,
  PendingSyncMsgEntry,
  SyncVersionWrite,
} from '../../types/index.ts';

const log = makeLogger('SyncPhantoms');

export type SyncPhantom = ChatSyncMsgV1<
  PhantomSyncMsgDataBasedOnRegularMsgV1 | ChatSystemMsgV1 | ChatInvitationMsgV1
>;

/**
 * Base of every phantom built here: who made the change, and when. The stamp
 * comes from the hybrid logical clock (nextSyncStamp()) and is the same one
 * recorded as the change's sync version.
 */
interface PhantomOrigin {
  chatId: ChatIdObj;
  sourceDeviceId: string;
  timestamp: number;
}

/**
 * Phantom of a system event that changes chat or message state, built from the
 * point where that change is applied locally.
 *
 * Every event used to be synchronized from the delivery-progress hook instead
 * (handle-system-sending-progress.ts), which made a phantom depend on delivery
 * to peers: nothing was sent when a peer was unreachable or when there were no
 * recipients at all, and the phantom's timestamp was the moment delivery
 * finished rather than the moment the change was made. The latter breaks
 * last-write-wins outright - a slowly delivered old change would outrank a
 * newer one.
 */
export function makeSystemEventPhantom({
  chatId,
  sourceDeviceId,
  timestamp,
  chatMessageId,
  chatSystemData,
}: PhantomOrigin & {
  chatMessageId?: string;
  chatSystemData: ChatSystemMsgV1['chatSystemData'];
}): SyncPhantom {
  const sysMsg: ChatSystemMsgV1 = {
    v: 1,
    chatMessageType: 'system',
    chatMessageId,
    groupChatId: chatId.isGroupChat ? chatId.chatId : undefined,
    chatSystemData,
  };

  return createSyncMsgBasedOnSystemMsg({ chatId, sourceDeviceId, timestamp, msg: sysMsg });
}

/**
 * Phantom carrying an authoritative status of an outgoing message on this
 * device: 'sending' when a (re)sending starts, and a terminal status ('sent' /
 * 'error') when the delivery is done. The record of the message itself is
 * synchronized separately, by a phantom sent when the record is placed into a
 * database.
 */
export function makeMsgRecordPhantom({
  chatId,
  sourceDeviceId,
  timestamp,
  msg,
}: PhantomOrigin & {
  msg: Pick<MsgDbEntry, 'chatMessageId' | 'groupChatId' | 'status' | 'history'>;
}): SyncPhantom {
  const sysMsg: ChatSystemMsgV1 = {
    v: 1,
    chatMessageType: 'system',
    chatMessageId: msg.chatMessageId,
    groupChatId: msg.groupChatId || undefined,
    chatSystemData: {
      event: 'update:msg-record',
      value: {
        chatMessageId: msg.chatMessageId,
        data: {
          status: msg.status,
          history: msg.history,
        },
      },
    },
  };

  return createSyncMsgBasedOnSystemMsg({ chatId, sourceDeviceId, timestamp, msg: sysMsg });
}

/**
 * Phantom of a 'delete:message' event (a single message, several messages, or
 * the whole chat history). Built where the deletion is applied locally, not
 * tied to delivery progress to peers - this also covers "delete for myself"
 * deletions, which never send anything to peers at all.
 */
export function makeDeleteMessagePhantom({
  chatId,
  sourceDeviceId,
  timestamp,
  value,
}: PhantomOrigin & { value: DeleteMessageSysMsgData['value'] }): SyncPhantom {
  return makeSystemEventPhantom({
    chatId,
    sourceDeviceId,
    timestamp,
    chatSystemData: { event: 'delete:message', value },
  });
}

/**
 * Phantom of an 'update:status' event ('sent' / 'read'). Built where the status
 * changes locally, not tied to delivery progress to peers - a status can change
 * purely locally (e.g. marking an incoming message as read), with nothing sent
 * to peers at all.
 */
export function makeMsgStatusPhantom({
  chatId,
  sourceDeviceId,
  timestamp,
  value,
}: PhantomOrigin & { value: UpdatedMsgStatusSysMsgData['value'] }): SyncPhantom {
  return makeSystemEventPhantom({
    chatId,
    sourceDeviceId,
    timestamp,
    chatSystemData: { event: 'update:status', value },
  });
}

/**
 * Phantom of a 'member-removed' event (chat deleted / left locally). Built
 * where the chat is removed locally, not tied to delivery progress to peers -
 * other peers may not even exist to notify (or their notification may fail),
 * but this device's own other devices must still learn that the chat is gone.
 */
export function makeMemberRemovedPhantom({
  chatId,
  sourceDeviceId,
  timestamp,
  chatDeleted,
}: PhantomOrigin & { chatDeleted?: MemberRemovalSysMsgData['chatDeleted'] }): SyncPhantom {
  return makeSystemEventPhantom({
    chatId,
    sourceDeviceId,
    timestamp,
    chatSystemData: { event: 'member-removed', chatDeleted },
  });
}

/**
 * Phantom carrying an invitation (chat creation, or a chat-membership update)
 * directly from local data. Built where the invitation record is placed into
 * the database - and unlike a delivery-progress hook re-reading the message
 * body back from the DB, this cannot pick up the wrong row when a
 * chatMessageId is reused for a differently-shaped event.
 */
export function makeInvitationPhantom({
  chatId,
  sourceDeviceId,
  timestamp,
  chatMessageId,
  inviteData,
}: PhantomOrigin & {
  chatMessageId: string;
  inviteData: ChatInvitationMsgV1['inviteData'];
}): SyncPhantom {
  return createSyncMsgBasedOnInvitationMsg({
    chatId,
    sourceDeviceId,
    timestamp,
    msg: { chatMessageId, inviteData },
  });
}

/**
 * Phantom of an 'accept:invitation' event - this device just accepted a chat
 * invitation, and its own other devices, which only know the chat as 'invited',
 * must learn the new status too.
 */
export function makeInvitationAcceptedPhantom({
  chatId,
  sourceDeviceId,
  timestamp,
  value,
}: PhantomOrigin & { value: AcceptedMsgBodySysMsgData['value'] }): SyncPhantom {
  return makeSystemEventPhantom({
    chatId,
    sourceDeviceId,
    timestamp,
    chatSystemData: { event: 'accept:invitation', value },
  });
}

/**
 * Writes a phantom into the journal together with the sync versions of the
 * change it announces, and then tries to release it right away.
 *
 * The journal row and the versions go in with one database operation, so no
 * file write can catch a spent ordering token without the phantom that is
 * supposed to spend it. Releasing right away keeps the usual case unchanged -
 * the phantom goes out immediately; what changes is the unusual one, where the
 * row simply stays until the next pass.
 *
 * `entity` describes the queued phantom for diagnostics; it defaults to the
 * first version written, and is given explicitly by phantoms that carry an
 * entity rather than a change of one of its aspects (aspect 'record').
 */
export async function queueSyncPhantom({
  db,
  ownAddr,
  phantom,
  versions,
  entity,
}: {
  db: DB;
  ownAddr: string;
  phantom: SyncPhantom;
  versions?: SyncVersionWrite[];
  entity?: Pick<PendingSyncMsgEntry, 'entityType' | 'entityId' | 'aspect'>;
}): Promise<void> {
  const describedBy = entity ?? versions?.[0];
  if (!describedBy) {
    throw new Error(`A sync phantom needs either a sync version to record, or an entity description`);
  }

  await db.queueSyncPhantom(
    {
      entityType: describedBy.entityType,
      entityId: describedBy.entityId,
      aspect: describedBy.aspect,
      ts: phantom.timestamp,
      payload: JSON.stringify(phantom),
    },
    versions,
  );

  await releasePendingSyncPhantoms(db, ownAddr);
}

/**
 * Journals every chunk of a restore snapshot, and makes ONE pass over the
 * journal afterwards.
 *
 * queueSyncPhantom() above releases on every call, which for a snapshot of
 * dozens of chunks would mean dozens of passes over a journal that grows with
 * each of them. The spacing, the stepping aside for a call and the retries all
 * work as they are - they belong to the pass, not to the queuing.
 *
 * No sync versions are written here: the restore has already written the
 * archived tokens, and this only announces them.
 *
 * The entityId names the part (`restore/<restoreId>#<part>`), which is what
 * keeps the chunks out of each other's way twice over: no two rows share an
 * (entity, aspect) pair, so planJournalRelease cannot pick one as "the newer
 * one" - and 'snapshot' is not in SUPERSEDABLE_ASPECTS to begin with.
 */
export async function queueSnapshotChunks({
  db,
  ownAddr,
  restoreId,
  chunks,
}: {
  db: DB;
  ownAddr: string;
  restoreId: string;
  chunks: SyncPhantom[];
}): Promise<void> {
  for (let i = 0; i < chunks.length; i += 1) {
    const phantom = chunks[i];
    await db.queueSyncPhantom({
      entityType: 'chat',
      entityId: `restore/${restoreId}#${i + 1}`,
      aspect: 'snapshot',
      ts: phantom.timestamp,
      payload: JSON.stringify(phantom),
    });
  }

  await releasePendingSyncPhantoms(db, ownAddr);
}

const releaseProc = new SingleProc();

/**
 * Aspects whose journal rows may supersede each other.
 *
 * Every one of them is a change of a single entity's single aspect, where the
 * receiver applies the newest token and nothing else (applyIfNewer), so sending
 * only the newest of several queued rows loses nothing.
 *
 * Deliberately excluded:
 *  - 'record' carries an entity rather than a change of its aspect, and a
 *    resync answer repeats a record with its *original* timestamp - "keep the
 *    greatest ts" would drop exactly the answer that was asked for;
 *  - 'deleted' and 'historyCleared' are tombstones, and a deletion phantom can
 *    cover more entities than the row naming it (a journal row is described by
 *    the first version written, see queueSyncPhantom), so a superseded row is
 *    not necessarily a subset of the newer one.
 */
const SUPERSEDABLE_ASPECTS: ReadonlySet<string> = new Set([
  'status', 'body', 'reactions', 'name', 'settings', 'members', 'admins',
]);

/**
 * Splits journal rows into the ones worth sending and the ones a later row of
 * the same (entity, aspect) has already made pointless.
 *
 * Pure, and exported for the spec: it decides what does *not* get sent, and
 * that is exactly the kind of rule worth pinning down by a table rather than by
 * a live run.
 */
export function planJournalRelease(
  rows: PendingSyncMsgDbEntry[],
): { release: PendingSyncMsgDbEntry[]; superseded: PendingSyncMsgDbEntry[] } {
  const newestOf = new Map<string, PendingSyncMsgDbEntry>();
  for (const row of rows) {
    if (!SUPERSEDABLE_ASPECTS.has(row.aspect)) {
      continue;
    }
    const key = `${row.entityType}\n${row.entityId}\n${row.aspect}`;
    const seen = newestOf.get(key);
    if (!seen || (row.ts > seen.ts) || ((row.ts === seen.ts) && (row.id > seen.id))) {
      newestOf.set(key, row);
    }
  }

  const release: PendingSyncMsgDbEntry[] = [];
  const superseded: PendingSyncMsgDbEntry[] = [];
  for (const row of rows) {
    const key = `${row.entityType}\n${row.entityId}\n${row.aspect}`;
    const winner = newestOf.get(key);
    if (winner && (winner.id !== row.id)) {
      superseded.push(row);
    } else {
      release.push(row);
    }
  }

  return { release, superseded };
}

export interface SyncPhantomReleaseResult {
  /** Phantoms handed to delivery in this pass. */
  handed: number;
  /** Journal rows dropped as superseded by a newer change of the same aspect. */
  superseded: number;
  /** Rows still awaiting release when the pass ended (those in flight excluded). */
  left: number;
  /** Rows inside a delivery, waiting for its outcome. */
  inFlight: number;
  /** The pass stopped because delivery refused a phantom. */
  failed: boolean;
  /** The pass did not run: a call is going on and signalling comes first. */
  deferred: boolean;
}

/**
 * "A call is going on" check. Phantoms share ASMail delivery with call
 * signalling, and signalling is the traffic that cannot wait; the journal is
 * what makes waiting safe for phantoms. Same idiom as ResyncCtx.isBusy, at
 * module level because the release itself is a module-level function called
 * from every place that queues a phantom.
 */
let isCallInProgress: (() => boolean) | undefined = undefined;

export function setPhantomReleaseBusyCheck(isBusy: () => boolean): void {
  isCallInProgress = isBusy;
}

/**
 * Where the outcome of a pass over the journal goes - the synchronization
 * indicator, in practice.
 *
 * At module level, and for the same reason as the check above: a pass is started
 * from every place that queues a phantom, from the retry timer and from the end
 * of a call, and only the two that happen to go through the service's IPC method
 * used to report anything. Everything a user does during a call takes one of the
 * other paths, so "the journal is held on purpose" never reached the indicator
 * and it stayed lit for the whole call (2026-08-14). Reporting from the pass
 * itself is what makes the flags a function of the last pass rather than of
 * which caller happened to start it.
 */
let passOutcomeSink: ((outcome: SyncPassOutcome) => void) | undefined = undefined;

export function setSyncPassOutcomeSink(sink: (outcome: SyncPassOutcome) => void): void {
  passOutcomeSink = sink;
}

function reportPassOutcome(outcome: SyncPassOutcome): void {
  try {
    passOutcomeSink?.(outcome);
  } catch (err) {
    // A reporting failure must not turn into a failure of the pass: the sink is
    // an indicator, and the phantoms are the work.
    w3n.log('error', `Sync pass outcome sink threw`, err);
  }
}

/**
 * Where the outcome of a phantom's *delivery* goes. Separate from the sink
 * above, and deliberately: a delivery outcome says nothing about whether the
 * journal is being held for a call, and reporting it as a pass outcome would
 * clear that flag in the middle of a call - the very defect this reporting was
 * added to fix.
 */
let deliveryOutcomeSink: ((outcome: 'delivered' | 'failed') => void) | undefined = undefined;

export function setSyncDeliveryOutcomeSink(
  sink: (outcome: 'delivered' | 'failed') => void,
): void {
  deliveryOutcomeSink = sink;
}

function reportDeliveryOutcome(outcome: 'delivered' | 'failed'): void {
  try {
    deliveryOutcomeSink?.(outcome);
  } catch (err) {
    w3n.log('error', `Sync delivery outcome sink threw`, err);
  }
}

/**
 * Backoff of the retry that re-arms a pass which left work behind.
 *
 * Until this existed, a pass stopped by a delivery failure was not retried at
 * all: the journal waited for the next local change or for a restart, so a
 * server answering 500 now and then - the situation this was written in - left a
 * device silently out of sync for hours. Backoff, because a failing server is
 * not helped by insistence.
 */
const RELEASE_RETRY_DELAYS_MILLIS = [30_000, 2 * 60_000, 10 * 60_000];

let retryTimer: ReturnType<typeof setTimeout> | undefined = undefined;
let retryStep = 0;

/**
 * Arms the next pass, unless one is already armed. `backOff` is false for a pass
 * that was merely deferred by a call: waiting out a call is not a failure, and
 * letting it consume the backoff would push the next attempt to ten minutes past
 * the call's end.
 */
function scheduleReleaseRetry(db: DB, ownAddr: string, backOff: boolean): void {
  if (backOff) {
    retryStep = Math.min(retryStep + 1, RELEASE_RETRY_DELAYS_MILLIS.length - 1);
  }
  if (retryTimer !== undefined) {
    return;
  }
  retryTimer = setTimeout(
    () => {
      retryTimer = undefined;
      releasePendingSyncPhantoms(db, ownAddr).catch(err => w3n.log(
        'error', `Retry pass over the journal of sync phantoms failed`, err,
      ));
    },
    RELEASE_RETRY_DELAYS_MILLIS[retryStep],
  );
}

function clearReleaseRetry(): void {
  retryStep = 0;
  if (retryTimer !== undefined) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }
}

/** Arms the next pass after a delivery outcome said the phantom did not arrive. */
export function scheduleSyncPhantomRetryAfterFailure(db: DB, ownAddr: string): void {
  scheduleReleaseRetry(db, ownAddr, true);
}

/**
 * Changes recorded on this device that are not on their way yet.
 *
 * This, and not the raw journal count, is what the synchronization indicator
 * shows and what `ChatSrv.countPendingSyncPhantoms()` reports - the latter has
 * always been documented as "recorded but not yet handed to delivery", and with
 * rows now living until a delivery confirms them the raw count would keep the
 * indicator lit for as long as the platform takes to report an outcome.
 */
export function countPhantomsAwaitingRelease(db: DB): number {
  const inFlight = countFlightsAwaitingOutcome(Date.now(), PHANTOM_FLIGHT_GRACE_MS);
  return Math.max(db.countPendingSyncPhantoms() - inFlight, 0);
}

/** Rows inside a delivery right now - diagnostics and specs. */
export function countSyncPhantomsInDelivery(): number {
  return countFlights();
}

/**
 * Settles a journal row by the outcome of the delivery that carried it: the row
 * is cleared when the phantom got through, and returned to the journal for
 * another attempt when it did not.
 *
 * Called by the delivery monitor on a terminal progress event, and by the
 * reconcile sweep for a delivery whose event never arrived. Both may race, and
 * neither needs to know about the other: taking the flight by its delivery id is
 * the arbiter, and whoever loses finds nothing and does nothing.
 */
export async function notePhantomDeliveryOutcome({
  db,
  ownAddr,
  deliveryId,
  progress,
}: {
  db: DB;
  ownAddr: string;
  deliveryId: string;
  progress: web3n.asmail.DeliveryProgress;
}): Promise<'delivered' | 'failed' | 'not-ours'> {
  const flight = takeFlightOfDelivery(deliveryId);
  if (!flight) {
    return 'not-ours';
  }

  if (!isTerminalDeliveryFailure(progress)) {
    await db.deletePendingSyncPhantom(flight.rowId);
    log.debug(
      `Sync phantom (${flight.describedBy}) delivered; journal row ${flight.rowId} `
        + `cleared (delivery ${deliveryId}).`,
    );
    reportDeliveryOutcome('delivered');
    return 'delivered';
  }

  const attempts = await db.recordPendingSyncPhantomFailure(flight.rowId);
  if (attempts === 0) {
    // The row is gone - superseded by a newer change of the same aspect while
    // this delivery was on its way. Nothing to retry.
    log.debug(
      `Delivery ${deliveryId} of sync phantom (${flight.describedBy}) failed, but its journal `
        + `row ${flight.rowId} is no longer there; nothing to retry.`,
    );
    return 'failed';
  }

  // At `error`, and deliberately: this is the event that was invisible in the
  // live run of 2026-08-14, and the one line that names a change which did not
  // reach the user's other devices. A phantom has one recipient, so this cannot
  // become a flood.
  log.error(
    `Sync phantom (${flight.describedBy}) failed delivery ${deliveryId}: `
      + `${describeDeliveryErrors(progress)}. Journal row ${flight.rowId} kept, `
      + `attempt ${attempts}; a retry pass is armed.`,
  );
  // Only on the branch that kept a row: a failure whose row is already gone
  // (the branch above) leaves nothing stuck, and reporting it would tell the
  // user about a change that is no longer waiting for anything.
  reportDeliveryOutcome('failed');
  scheduleReleaseRetry(db, ownAddr, true);
  return 'failed';
}

/**
 * Hands journalled phantoms to delivery. A row is cleared only once the delivery
 * has actually finished - see phantom-flight.ts for why "accepted by addMsg()"
 * was the wrong moment and what it cost.
 *
 * Called after each queueing, at startup (where it picks up whatever the previous
 * run of the component left behind, plus everything left unconfirmed), when a
 * call ends, and by the retry timer.
 *
 * Re-sending a phantom that did in fact arrive is harmless: an incoming phantom
 * with an ordering token this device has already applied loses to the stored one
 * (isNewerToken() is false for an equal token) and is skipped. That is what makes
 * every recovery path here safe to take twice.
 */
export function releasePendingSyncPhantoms(db: DB, ownAddr: string): Promise<SyncPhantomReleaseResult> {
  return releaseProc.startOrChain(async () => {
    // Reported here rather than at each `return` of the pass: there are five of
    // them, and the next one added would silently fall out of the reporting
    // again. That is exactly how the indicator came to ignore a held journal.
    // A throw is an outcome too - the flags must not be left frozen on the
    // reading of some earlier pass.
    try {
      const result = await runReleasePass(db, ownAddr);
      reportPassOutcome(syncPassOutcome(result));
      return result;
    } catch (err) {
      reportPassOutcome('failed');
      throw err;
    }
  });
}

async function runReleasePass(db: DB, ownAddr: string): Promise<SyncPhantomReleaseResult> {
  const dropped = await db.dropExpiredSyncPhantoms(Date.now());
  if (dropped > 0) {
    await w3n.log(
      'error',
      `Dropped ${dropped} sync phantom(s) older than the synchronization window. ` +
        `The changes they announce will not reach other devices of this user.`,
    );
  }

  const queued = db.getPendingSyncPhantoms();

  // Rows leave the journal by paths the flight registry knows nothing about
  // (superseded, aged out, unreadable payload). A flight left behind would keep
  // being subtracted from the count that drives the indicator, so the registry
  // is reconciled with the journal at the head of every pass.
  for (const stale of flightsToForget(currentFlights(), new Set(queued.map(({ id }) => id)))) {
    forgetFlightOfRow(stale.rowId);
  }

  if (queued.length === 0) {
    clearReleaseRetry();
    return { handed: 0, superseded: 0, left: 0, inFlight: 0, failed: false, deferred: false };
  }

  const { release, superseded } = planJournalRelease(queued);
  for (const row of superseded) {
    // A superseded row may be inside a delivery of its own; its outcome is of
    // no interest any more, and the flight must not outlive the row.
    forgetFlightOfRow(row.id);
    await db.deletePendingSyncPhantom(row.id);
  }
  if (superseded.length > 0) {
    await w3n.log(
      'info',
      `Dropped ${superseded.length} sync phantom(s) superseded by a newer change of the same aspect; `
        + `${release.length} left to send.`,
    );
  }

  const now = Date.now();
  const { releasable, waiting, abandoned } = partitionByFlight(
    release, currentFlights(), now, PHANTOM_FLIGHT_GRACE_MS,
  );
  for (const flight of abandoned) {
    forgetFlightOfRow(flight.rowId);
    const attempts = await db.recordPendingSyncPhantomFailure(flight.rowId);
    log.warn(
      `Sync phantom (${flight.describedBy}) handed to delivery ${flight.deliveryId} `
        + `${Math.round((now - flight.handedAt) / 1000)}s ago never reported an outcome; `
        + `releasing it again (attempt ${attempts}).`,
    );
  }

  if (releasable.length === 0) {
    // Everything left is inside a delivery: its outcome will either clear the
    // row or arm a retry, so there is nothing to schedule here.
    return {
      handed: 0,
      superseded: superseded.length,
      left: countPhantomsAwaitingRelease(db),
      inFlight: waiting.length,
      failed: false,
      deferred: false,
    };
  }

  if (isCallInProgress?.()) {
    await w3n.log(
      'info',
      `Holding ${releasable.length} sync phantom(s) in the journal while a call is on; `
        + `they go out when it ends.`,
    );
    scheduleReleaseRetry(db, ownAddr, false);
    return {
      handed: 0,
      superseded: superseded.length,
      left: countPhantomsAwaitingRelease(db),
      inFlight: waiting.length,
      failed: false,
      deferred: true,
    };
  }

  let handed = 0;
  for (const row of releasable) {
    let phantom: SyncPhantom;
    try {
      phantom = JSON.parse(row.payload) as SyncPhantom;
    } catch (err) {
      await w3n.log('error', `Unreadable payload of a queued sync phantom ${row.id}; dropping it.`, err);
      forgetFlightOfRow(row.id);
      await db.deletePendingSyncPhantom(row.id);
      continue;
    }

    const outMsg: ChatOutgoingMessage = {
      msgType: 'chat',
      jsonBody: phantom,
    };
    const localMeta: LocalMetadataInDelivery = {
      chatMessageType: 'synchronization',
      chatId: phantom.chatId,
      chatMessageId: phantom.value.chatMessageId,
      // Diagnostics only: which journal row this delivery carries. The decision
      // to settle a row always comes from the flight registry, never from here -
      // a row id from a previous process would point at a row that has since
      // been released again.
      syncJournalRowId: row.id,
    };

    // Spacing goes before every message but the first: the ordinary path -
    // one change, one phantom - must stay as immediate as it was, while a
    // pass over a backlog must not begin dozens of deliveries at once.
    if (handed > 0) {
      await sleep(PHANTOM_SEND_SPACING_MS);
    }

    // Registered BEFORE the handover, not after: the terminal event arrives
    // over IPC and can land while addMsg() is still being awaited, and an
    // event that finds no flight is ignored - which would leave the row in the
    // pool while its delivery is alive.
    const deliveryId = newSyncPhantomDeliveryId();
    notePhantomHandedToDelivery({
      rowId: row.id,
      deliveryId,
      handedAt: Date.now(),
      describedBy: describeJournalRow(row),
    });

    try {
      await addMessageToDeliveryList(outMsg, [ownAddr], localMeta, deliveryId);
      handed += 1;
      log.debug(
        `Handed sync phantom (${describeJournalRow(row)}) to delivery ${deliveryId}; `
          + `journal row ${row.id} stays until the outcome is known.`,
      );
    } catch (err) {
      forgetFlightOfRow(row.id);
      await w3n.log(
        'error',
        `Failed to hand a queued sync phantom (${describeJournalRow(row)}) ` +
          `to delivery; it stays in the journal.`,
        err,
      );
      const attempts = await db.recordPendingSyncPhantomFailure(row.id);

      // The pass stops at the first failure instead of walking the rest.
      // Handing a message to delivery fails for one reason in practice - the
      // server cannot be reached - and that reason is the same for every row.
      // Trying them all would make each local change wait out one connection
      // timeout per queued phantom, so an offline device would get slower
      // with every change it makes.
      await w3n.log(
        'info',
        `Sync phantom release stopped after ${handed} phantom(s); `
          + `${countPhantomsAwaitingRelease(db)} awaiting release `
          + `(attempt ${attempts} of the failed one).`,
      );
      scheduleReleaseRetry(db, ownAddr, true);
      return {
        handed,
        superseded: superseded.length,
        left: countPhantomsAwaitingRelease(db),
        inFlight: countFlightsAwaitingOutcome(Date.now(), PHANTOM_FLIGHT_GRACE_MS),
        failed: true,
        deferred: false,
      };
    }
  }

  const left = countPhantomsAwaitingRelease(db);
  if (left > 0) {
    // Rows queued while this pass was running: there is work left, and it must
    // not wait for the next local change.
    scheduleReleaseRetry(db, ownAddr, false);
  } else {
    clearReleaseRetry();
  }

  const inFlight = countFlightsAwaitingOutcome(Date.now(), PHANTOM_FLIGHT_GRACE_MS);
  if ((superseded.length > 0) || (left > 0)) {
    await w3n.log(
      'info',
      `Sync phantom pass: handed ${handed}, ${inFlight} awaiting an outcome, `
        + `${left} awaiting release, ${superseded.length} superseded.`,
    );
  }

  return {
    handed,
    superseded: superseded.length,
    left,
    inFlight,
    failed: false,
    deferred: false,
  };
}
