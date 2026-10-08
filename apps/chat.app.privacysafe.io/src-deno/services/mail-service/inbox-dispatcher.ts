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
import type {
  ChatIncomingMessage,
  ChatSystemMsgV1,
  ChatWebRTCMsgV1,
  WebRTCMsg,
} from '../../../types/asmail-msgs.types.ts';
import type { ChatSrv, DB, LocalDataStore, VideoChatSrv } from '../../types/index.ts';
import type { SyncActivityTracker } from '../../utils/sync-activity.ts';
import { SingleProc } from '../../../shared-libs/processes/single.ts';
import { startStageFirst } from '../video-chat-service/utils/_common.ts';
import { MAX_SIGNAL_AGE_MILLIS } from '../video-chat-service/utils/call-state.ts';
import { INBOX_COMMIT_BATCH, INBOX_SCAN_FLOOR_MS, MAX_WATERMARK_LAG } from '../../../shared-libs/constants/index.ts';
import { makeLogger } from '../../../shared-libs/logger.ts';
import { areAddressesEqual } from '../../../shared-libs/address-utils.ts';
import { removeMessageFromInbox } from '../../utils/inbox-utils.ts';
import type { BlacklistTracker } from '../contacts-service/contacts-blacklist.ts';
import { startupStage } from '../../utils/startup-progress.ts';

const log = makeLogger('InboxDispatcher');

/**
 * Whether a message is a phantom from *another* device of this user - which is
 * the whole of what the synchronization indicator is about.
 *
 * An ASMail inbox belongs to the user, not to a device, so a phantom this device
 * sent comes back to this device as well. Nothing is applied from such a copy:
 * it is recognized by its `sourceDeviceId` and scheduled for removal
 * (chat-service.ts). Counting it as incoming work told a user with a single
 * device that their device was synchronizing - with nobody, at every start-up
 * and after every message they sent (2026-08-14).
 *
 * A body without `sourceDeviceId` is not counted either: a phantom that cannot
 * name its origin cannot be shown as another device's work.
 */
export function isSyncPhantomFromOtherDevice(
  body: { chatMessageType?: string; sourceDeviceId?: string } | undefined,
  ownDeviceId: string,
): boolean {
  if (body?.chatMessageType !== 'synchronization') {
    return false;
  }
  return !!body.sourceDeviceId && (body.sourceDeviceId !== ownDeviceId);
}

/**
 * Inbox Dispatcher
 * 
 * Responsible for:
 * - Subscribing to incoming messages from inbox
 * - Routing messages to appropriate handlers (chat or WebRTC)
 * - Processing missed messages on startup
 * - Managing message queues for sequential processing
 */
export async function inboxDispatcher({
  ownAddr,
  chatsSrv,
  videoChatSrv,
  localDataStoreSrv,
  db,
  syncActivity,
  blacklistTracker,
}: {
  ownAddr: string;
  chatsSrv: ChatSrv;
  videoChatSrv: VideoChatSrv;
  localDataStoreSrv: LocalDataStore;
  db: DB;
  syncActivity: SyncActivityTracker;
  blacklistTracker: BlacklistTracker;
}): Promise<{ stop: () => void }> {
  const chatMsgsQueue: ChatIncomingMessage[] = [];

  const isSyncPhantom = (body: { chatMessageType?: string } | undefined): boolean =>
    body?.chatMessageType === 'synchronization';
  const chatMsgsProc = new SingleProc();

  const webRTCMsgsQueue: ChatIncomingMessage[] = [];
  const webRTCMsgsProc = new SingleProc();

  /**
   * Guards against processing the same inbox message twice. This matters
   * because a message can, in theory, be seen both by the live
   * `inbox.subscribe()` callback and by the startup catch-up scan in
   * `handleMissedInboxMessages()` if it arrives right around dispatcher
   * start-up. Without this guard such a message could be handed to
   * `videoChatSrv.handleIncomingWebRTCMsg()` (or `chatsSrv.handleIncomingMsg()`)
   * twice, which for WebRTC signalling could mean e.g. two attempts to
   * register the same call.
   */
  const seenMsgIds = new Set<string>();

  /**
   * The oldest deliveryTS this session failed to fetch or process. The
   * watermark must not be committed past it: everything the next start-up's
   * catch-up scan returns is at or after the watermark, so a message that
   * jumped over would never be listed again - failing once would lose it for
   * good, while re-processing is merely idempotent work.
   *
   * One floor for both queues, because both committers feed the same
   * monotonic watermark: a failure in one queue would otherwise be jumped
   * over by the other queue's commit.
   *
   * A commit that already went through before the failure was seen cannot be
   * taken back (the watermark never moves down) - that window is a batch at
   * most, and the failure is logged when it happens.
   *
   * The hold is bounded by MAX_WATERMARK_LAG behind the newest processed
   * message: a message that fails at every attempt would otherwise pin the
   * watermark forever, and every start-up's catch-up scan would grow into a
   * re-fetch of an unbounded stretch of the inbox - a burst of load exactly
   * when the app (and possibly a call) is starting. Within the window the
   * failed message is retried by every scan; past it, it is given up on.
   */
  function makeFailureFloor() {
    let oldestFailedTS = Infinity;
    return {
      recordFailure(deliveryTS: number): void {
        oldestFailedTS = Math.min(oldestFailedTS, deliveryTS);
      },
      capFor: (ts: number): number => Math.min(ts, Math.max(oldestFailedTS, ts - MAX_WATERMARK_LAG)),
    };
  }

  const failureFloor = makeFailureFloor();

  /**
   * Makes processed messages durable and only then advances the watermark.
   *
   * The order is what matters. The watermark is written to its own file
   * immediately and never moves back, while database writes are batched; if the
   * watermark went first, a crash would leave messages that the next start-up's
   * catch-up scan no longer returns and that are in no database - lost for
   * good. This way the worst case is re-processing the batch, and processing is
   * idempotent (see the "already processed" check in msg-sending.ts).
   *
   * Committing per batch rather than per message is what makes batched writes
   * worth anything: a burst of incoming messages is exactly the case being
   * optimized, and flushing on each one would put the writes right back.
   */
  function makeWatermarkCommitter(queueName: string) {
    let processedTS = 0;
    let sinceCommit = 0;

    return {
      recordProcessed(deliveryTS: number): void {
        processedTS = Math.max(processedTS, deliveryTS);
        sinceCommit += 1;
      },
      isBatchFull: () => sinceCommit >= INBOX_COMMIT_BATCH,
      async commit(): Promise<void> {
        if (processedTS === 0) {
          return;
        }
        const tsToCommit = processedTS;
        const countToCommit = sinceCommit;
        const ts = failureFloor.capFor(tsToCommit);
        if (ts < tsToCommit) {
          log.info(
            `Watermark of ${queueName} held at ${ts} instead of ${tsToCommit}: `
              + `an older message failed this session and must be seen by the next catch-up scan`,
          );
        }
        try {
          await db.flush();
          await localDataStoreSrv.setLastReceivedMessageTimestamp(ts);
          if (processedTS === tsToCommit) {
            processedTS = 0;
            sinceCommit = 0;
          } else {
            sinceCommit = Math.max(0, sinceCommit - countToCommit);
          }
          log.debug(`Committed ${queueName} watermark: ${ts}`);
        } catch (err) {
          log.error(`Failed to commit ${queueName} watermark for timestamp ${ts}:`, err);
          throw err;
        }
      },
    };
  }

  // Separate accumulators: the two queues run on their own SingleProc, so they
  // drain concurrently.
  const chatMsgsCommitter = makeWatermarkCommitter('chat queue');
  const webRTCMsgsCommitter = makeWatermarkCommitter('webrtc queue');

  async function processQueuedChatMsg() {
    while (chatMsgsQueue.length > 0) {
      const msg = chatMsgsQueue.shift()!;
      try {
        await chatsSrv.handleIncomingMsg(msg);
        // Only successfully processed messages move the watermark, so one that
        // threw is picked up again on the next start-up.
        chatMsgsCommitter.recordProcessed(msg.deliveryTS);
        if (chatMsgsCommitter.isBatchFull()) {
          try {
            await chatMsgsCommitter.commit();
          } catch (err) {
            log.warn(`Batch commit failed for chat messages, will retry at end of queue:`, err);
          }
        }
      } catch (err) {
        failureFloor.recordFailure(msg.deliveryTS);
        await w3n.log('error', `Processing incoming chat message ${msg.msgId} threw an error.`, err).catch(() => {});
      } finally {
        // Mirrors the counting in handleIncomingMessage() below, and has to: a
        // condition that drifts from it leaves the counter stuck above zero.
        if (isSyncPhantomFromOtherDevice(msg.jsonBody, chatsSrv.getAppDeviceId())) {
          syncActivity.inboundDone();
        }
      }
    }
    try {
      await chatMsgsCommitter.commit();
    } catch (err) {
      log.error(`Failed to commit final chat messages watermark:`, err);
    }
  }

  async function processQueuedWebRTCMsg() {
    while (webRTCMsgsQueue.length > 0) {
      const msg = webRTCMsgsQueue.shift()!;
      try {
        await videoChatSrv.handleIncomingWebRTCMsg(msg);
        // See the matching comment in processQueuedChatMsg().
        webRTCMsgsCommitter.recordProcessed(msg.deliveryTS);
        if (webRTCMsgsCommitter.isBatchFull()) {
          try {
            await webRTCMsgsCommitter.commit();
          } catch (err) {
            log.warn(`Batch commit failed for webrtc messages, will retry at end of queue:`, err);
          }
        }
      } catch (err) {
        failureFloor.recordFailure(msg.deliveryTS);
        await w3n.log('error', `Processing incoming WebRTC signalling message ${msg.msgId} threw an error.`, err).catch(() => {});
      }
    }
    try {
      await webRTCMsgsCommitter.commit();
    } catch (err) {
      log.error(`Failed to commit final webrtc messages watermark:`, err);
    }
  }

  /**
   * A system message about a cancelled call that is too old to be replayed.
   *
   * Every other kind of missed message is replayed regardless of age, on purpose
   * (see the note on handleMissedInboxMessages below). These are the exception,
   * because their age is not a proxy for anything - it is the whole question: a
   * cancellation says "the call you are in is over", and one from an hour ago says
   * nothing about the call happening now. Being replayed at every start-up for
   * the fifteen days such a message sits in the inbox is how a cancellation of a
   * long-finished call came to end a call that had only just started.
   *
   * Reaching the replay scan at all means it was already handled once (an
   * unhandled one would not have let the watermark past it), so scheduling its
   * removal here loses nothing. That removal is deferred like every other one
   * (the inbox is shared between the user's devices), so the message may still be
   * listed by a later scan - what keeps it from being replayed then is this same
   * check, not its removal.
   */
  function isStaleCallSysMsg(msg: ChatIncomingMessage, now: number): boolean {
    if (msg.jsonBody?.chatMessageType !== 'system') {
      return false;
    }
    const { chatSystemData } = msg.jsonBody as ChatSystemMsgV1;
    return (chatSystemData?.event === 'webrtc-call')
      && ((now - msg.deliveryTS) > MAX_SIGNAL_AGE_MILLIS);
  }

  /**
   * Processes messages missed while the dispatcher was not yet subscribed
   * (e.g. app/background process was starting up on a slower machine while
   * a peer already sent a call 'start' signal).
   *
   * Rather than discarding webrtc-call messages based on an arbitrary
   * wall-clock age (which is a poor proxy for relevance — a slow machine
   * can easily take longer to start than any fixed timeout), all missed
   * webrtc-call messages are handed to the normal handling pipeline
   * (`videoChatSrv.handleIncomingWebRTCMsg`), which already implements the
   * correct call-lifecycle semantics: a 'start' creates the call, a
   * 'disconnect' with no active call is a no-op discard, buffered
   * 'signalling' is drained once the call exists, etc.
   *
   * The only thing this function must guarantee itself is *ordering*:
   * within a batch of missed messages, 'start' must be processed before
   * any related 'signalling'/'disconnect' for the same call, otherwise
   * e.g. an offer could arrive before the call/CallInChat exists. This is
   * done via `startStageFirst`, a stable sort that only reorders 'start'
   * messages to the front and otherwise preserves delivery order.
   */
  async function handleMissedInboxMessages(): Promise<void> {
    syncActivity.beginCatchUpScan();
    try {
      await scanMissedInboxMessages();
    } finally {
      syncActivity.endCatchUpScan();
    }
  }

  async function scanMissedInboxMessages(): Promise<void> {
    const watermark = localDataStoreSrv.getLastReceivedMessageTimestamp();
    // Floored, not clamped at zero: listMsgs(0) throws ENOENT instead of
    // listing (see INBOX_SCAN_FLOOR_MS), so a device with a zero watermark -
    // a fresh install, which is precisely the state that needs the scan most -
    // used to pick up nothing at all from the shared inbox.
    const scanFrom = Math.max(watermark - 60 * 1000, INBOX_SCAN_FLOOR_MS);
    // Timed on its own, and loudly: this one call is where whole minutes of a
    // start used to disappear with nothing in the log between the scan's first
    // line and its last (2026-09-11). It is a request to the ASMail server,
    // and the platform puts no timeout on it, so "how long did the listing
    // take" is a question only we can answer.
    const listMessages = await startupStage(
      'mail/catch-up-list',
      () => w3n
        .mail!.inbox.listMsgs(scanFrom)
        .catch(err => w3n.log('error', `Fail to list messages`, err)),
      15000,
    );

    if (!listMessages) {
      // An error, not info: a refused listing is not "nothing to list", and it
      // costs this start-up every phantom and every missed message that is only
      // in the shared inbox. A single info line is why this went unnoticed.
      log.error(`Catch-up scan got no listing (watermark: ${watermark}); only live messages will be handled`);
      return;
    }

    log.info(
      `Catch-up scan: watermark ${watermark}, listing since ${scanFrom} `
        + `returned ${listMessages.length} message(s)`,
    );

    await startupStage(
      'mail/catch-up-handle', () => handleListedInboxMessages(listMessages), 15000,
    );
  }

  async function handleListedInboxMessages(
    listMessages: web3n.asmail.MsgInfo[],
  ): Promise<void> {
    const now = Date.now();
    const webrtcCandidates: Array<{ msg: ChatIncomingMessage; webrtcMsg: WebRTCMsg }> = [];
    let queuedChat = 0;
    let stale = 0;
    let blacklisted = 0;
    let failed = 0;
    // Phantoms are counted apart, and those of this very device apart from the
    // rest: two app instances started on one data folder share a device id, and
    // then every phantom in the listing is "own" on both of them. A line saying
    // "8 sync (8 own)" on two devices at once names that misconfiguration.
    let syncPhantoms = 0;
    let ownSyncPhantoms = 0;
    const thisDeviceId = chatsSrv.getAppDeviceId();

    for (const item of listMessages) {
      const { msgId, msgType, deliveryTS } = item;
      if (msgType !== 'chat') {
        continue;
      }
      try {
        const msg = (await w3n.mail!.inbox.getMsg(msgId)) as ChatIncomingMessage;
        if (!msg) {
          // An unavailable message must be seen by the next scan too, so the
          // watermark is not allowed past it (see makeFailureFloor).
          failed += 1;
          failureFloor.recordFailure(deliveryTS);
          log.error(`Catch-up scan: getMsg(${msgId}) returned nothing (deliveryTS: ${deliveryTS})`);
          continue;
        }
        if (!areAddressesEqual(msg.sender, ownAddr) && blacklistTracker.isBlacklisted(msg.sender)) {
          blacklisted += 1;
          // A message received BEFORE the blocking is the user's, and only they
          // delete it. This scan does come back round to such a message: the
          // watermark is set from the newest incoming row at every start and the
          // listing begins a minute before it, and a message with attachments
          // stays in the inbox indefinitely - it is where its file bytes live.
          // Removing it would leave the history entry pointing at nothing.
          if (db.isMsgKeptForInboxMsg(msgId)) {
            log.info(
              `Catch-up scan: message ${msgId} is from blacklisted sender ${msg.sender}, but it was received before the blocking and its record still holds it; leaving it on the server`,
            );
            chatMsgsCommitter.recordProcessed(deliveryTS);
            continue;
          }
          log.info(
            `Catch-up scan: message ${msgId} from blacklisted sender ${msg.sender} ignored; removing from server inbox`,
          );
          await removeMessageFromInbox(msgId).catch(err =>
            w3n.log('error', `Fail to remove blacklisted inbox message ${msgId}`, err),
          );
          chatMsgsCommitter.recordProcessed(deliveryTS);
          continue;
        }
        log.debug(
          `Catch-up scan: ${msgId} (deliveryTS: ${deliveryTS}, `
            + `type: ${(msg.jsonBody as { chatMessageType?: string })?.chatMessageType})`,
        );
        if (isSyncPhantom(msg.jsonBody)) {
          syncPhantoms += 1;
          if ((msg.jsonBody as { sourceDeviceId?: string }).sourceDeviceId === thisDeviceId) {
            ownSyncPhantoms += 1;
          }
        }
        if (msg.jsonBody?.chatMessageType === 'webrtc-call') {
          const webrtcBody = msg.jsonBody as ChatWebRTCMsgV1;
          if (webrtcBody.webrtcMsg) {
            webrtcCandidates.push({ msg, webrtcMsg: webrtcBody.webrtcMsg });
          }
        } else if (isStaleCallSysMsg(msg, now)) {
          stale += 1;
          log.info(
            `Not replaying a stale call system message ${msgId} from ${msg.sender} `
              + `(age: ${now - msg.deliveryTS}ms); scheduling its removal from inbox`,
          );
          await db.scheduleInboxMsgRemoval(msgId).catch(err => w3n.log(
            'error', `Fail to schedule removal of stale call system message ${msgId}`, err,
          ));
        } else {
          queuedChat += 1;
          handleIncomingMessage(msg);
        }
      } catch (e) {
        // Same as above: a failed fetch must not be jumped over by the
        // watermark, or this message is never listed again.
        failed += 1;
        failureFloor.recordFailure(deliveryTS);
        w3n.log('error', `Fail to get message ${msgId}`, e);
      }
    }

    log.info(
      `Catch-up scan handled ${listMessages.length} message(s): ${queuedChat} queued as chat `
        + `(${syncPhantoms} sync phantom(s), ${ownSyncPhantoms} of them from this device `
        + `${thisDeviceId}), ${webrtcCandidates.length} webrtc, ${stale} stale call sysmsg(s), `
        + `${blacklisted} blacklisted, ${failed} failed to fetch`,
    );

    // Ensure 'start' is handed to VideoChatSrv before any 'signalling'/
    // 'disconnect' for the same call, regardless of the order messages were
    // returned in by listMsgs().
    webrtcCandidates.sort((a, b) => startStageFirst(a.webrtcMsg, b.webrtcMsg));

    for (const { msg, webrtcMsg } of webrtcCandidates) {
      log.debug(`Forwarding missed WebRTC msg ${msg.msgId} from ${msg.sender}, stage: ${webrtcMsg.stage}`);
      handleIncomingMessage(msg);
    }
  }

  function handleIncomingMessage(msg: web3n.asmail.IncomingMessage) {
    try {
      const { msgType, msgId } = msg;
      if (msgType !== 'chat') {
        return;
      }

      if (seenMsgIds.has(msgId)) {
        return;
      }
      seenMsgIds.add(msgId);

      const incomingChatMsg = msg as ChatIncomingMessage;
      if (!areAddressesEqual(incomingChatMsg.sender, ownAddr) && blacklistTracker.isBlacklisted(incomingChatMsg.sender)) {
        // Normally new, and normally not in the database - but the platform can
        // hand the same message over again, and the one already kept for its
        // attachments must not be taken off the server. See the catch-up scan.
        const keptAlready = db.isMsgKeptForInboxMsg(msgId);
        log.info(
          keptAlready
            ? `Incoming message ${msgId} from blacklisted sender ${incomingChatMsg.sender} ignored; it was received before the blocking, so it stays on the server`
            : `Incoming message ${msgId} from blacklisted sender ${incomingChatMsg.sender} ignored; removing from server inbox`,
        );
        if (!keptAlready) {
          removeMessageFromInbox(msgId).catch(err =>
            w3n.log('error', `Fail to remove blacklisted inbox message ${msgId}`, err),
          );
        }
        chatMsgsCommitter.recordProcessed(incomingChatMsg.deliveryTS);
        chatMsgsProc
          .startOrChain(processQueuedChatMsg)
          .catch(err => w3n.log('error', `Chat message queue run failed`, err));
        return;
      }

      const { jsonBody } = incomingChatMsg;

      if (jsonBody?.chatMessageType === 'webrtc-call') {
        const webrtcBody = jsonBody as ChatWebRTCMsgV1;
        const receivedLine = `Received WebRTC msg from ${(msg as ChatIncomingMessage).sender}, stage: ${webrtcBody.webrtcMsg?.stage}, msgId: ${msgId}`;
        // 'start' and 'disconnect' at `info`: this line is the proof that the
        // message reached *this* device's inbox at all, which is what separates a
        // delivery problem from a call-lifecycle verdict (see logDroppedSignal in
        // video-chat-service.ts). An inbox belongs to the user, not to a device,
        // so with several devices online the two are easy to confuse.
        if ((webrtcBody.webrtcMsg?.stage === 'start')
          || (webrtcBody.webrtcMsg?.stage === 'disconnect')) {
          log.info(receivedLine);
        } else {
          log.debug(receivedLine);
        }
        webRTCMsgsQueue.push(msg as ChatIncomingMessage);
        // startOrChain, not "start if idle": a push that lands while the running
        // drain is past its queue check (in the final commit, say) would see a
        // busy proc, start nothing, and sit in the queue until the *next* push
        // happens to arrive. A chained run on an already-drained queue is a
        // cheap no-op.
        webRTCMsgsProc
          .startOrChain(processQueuedWebRTCMsg)
          .catch(err => w3n.log('error', `WebRTC message queue run failed`, err));
        return;
      }

      // Our own phantom is still queued and handled below - it has to be scheduled
      // for removal - it is simply not work to report.
      if (isSyncPhantomFromOtherDevice(jsonBody, chatsSrv.getAppDeviceId())) {
        syncActivity.inboundEnqueued();
      }
      chatMsgsQueue.push(msg as ChatIncomingMessage);
      // See the matching comment on the webrtc queue above.
      chatMsgsProc
        .startOrChain(processQueuedChatMsg)
        .catch(err => w3n.log('error', `Chat message queue run failed`, err));
    } catch (err) {
      log.error(`Failed to handle incoming message ${msg?.msgId}:`, err);
      w3n.log('error', `Failed to handle incoming message ${msg?.msgId}`, err).catch(() => {});
    }
  }

  const stopInboxWatching = await startupStage(
    'mail/inbox-subscribe',
    async () => w3n.mail!.inbox.subscribe('message', {
      next: msg => {
        try {
          handleIncomingMessage(msg);
        } catch (err) {
          log.error(`Error in inbox message subscriber callback:`, err);
        }
      },
      error: err => w3n.log('error', `Inbox subscribe error: `, err),
    }),
    15000,
  );

  // Not awaited, and that is the point. The scan is a request to the ASMail
  // server with no timeout on it, and it was measured taking between 15 and 88
  // seconds on ordinary starts (2026-09-11); until it came back, this function
  // did not return, `mailService` did not return, and the component did not
  // count as ready - while the user looked at a working app whose incoming
  // side was not up yet.
  //
  // Safe to overlap with live traffic, and for reasons that predate this
  // change rather than being assumed by it: the subscription above is already
  // installed before the scan starts, so the two have always been able to
  // produce the same message, and `seenMsgIds` in handleIncomingMessage() is
  // what makes the second copy a no-op. The watermark tolerates the overlap
  // too - it is read once at the top of the scan, only successfully processed
  // messages move it, and it never moves down (see makeWatermarkCommitter).
  //
  // What the scan still owes the start is ordering within itself ('start'
  // before the signalling of the same call), and that is unchanged: the sort
  // is over the scan's own batch.
  startupStage('mail/catch-up', () => handleMissedInboxMessages(), 15000)
    .catch(err => {
      log.error(`Catch-up scan of the inbox failed:`, err);
      w3n.log('error', `Catch-up scan of the inbox failed`, err).catch(() => {});
    });

  return {
    stop: () => {
      stopInboxWatching();
    },
  };
}