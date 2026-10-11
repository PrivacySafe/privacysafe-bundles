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
import type { ChatIdObj, ChatIncomingMessage, ChatSystemMessageData, WebRTCMsg, WebRTCOffBandMessage } from '../../../types/asmail-msgs.types.ts';
import type { IncomingCallCmdArg, OpenChatCmdArg } from '../../../types/chat-commands.types.ts';
import type { CallStateForGui, ChatInfoForCall, VideoChatEvent } from '../../../types/services.types.ts';
import type { CallInChat, ChatDbEntry, ChatSrv, ChatSrvEmit, DB, LocalDataStore, MsgDbEntry, VideoChatSrv } from '../../types/index.ts';
import type { BlacklistTracker } from '../contacts-service/contacts-blacklist.ts';
import { MultiConnectionIPCWrap } from '../../../shared-libs/ipc/ipc-service.js';
import { facadeOver } from '../chat-service/ipc-expose.ts';
import { ObserversSet } from '../../../shared-libs/observer-utils.ts';
import { includesAddress, areAddressesEqual } from '../../../shared-libs/address-utils.ts';
import {
  chatIdToString, chatMessageIdForCallEvent, generateChatMessageId, hostAddrOfCallSession,
} from '../../../shared-libs/chat-ids.ts';
import { sendWebRTCSignal, starSignalTypeOf } from '../../../shared-libs/webrtc-signalling.ts';
import { removeMessageFromInbox, removeMessagesFromInboxBatch } from '../../utils/inbox-utils.ts';
import {
  checkChatMessageJSONforWebRTC,
  REJOIN_NOTICE_REPEAT_DELAYS_MILLIS,
  rejoinNoticeMsg,
  relayRejoinHeartbeat,
  sendCallCollision,
  sendSystemMsgAboutFailedCallCollision,
  sendCallDeclined,
  sendCallHandledElsewhere,
  sendWebRTCMsg,
  signalAgeOf,
} from './utils/_common.ts';
import { callInChat } from './utils/call.ts';
import { pickCallRecordToStamp } from './utils/call-record.ts';
import type {
  CallCancelSysMsgVerdict, CallCollisionParty, CallSessionPatch, CallState, SignalAge, SignalVerdict,
} from './utils/call-state.ts';
import {
  admitsCallCancelSysMsg,
  callCollisionWinner,
  createCallSessions,
  isHostEndingRingingCall,
  callHandledElsewhereOutcome,
  isLiveState,
  isSignallingState,
  isStaleAge,
  MAX_SIGNAL_AGE_MILLIS,
  rejoinTargetOf,
  shouldRelayRejoinBeat,
  RINGING_NO_ANSWER_TIMEOUT_MILLIS,
} from './utils/call-state.ts';
import {
  HANDLED_ELSEWHERE_MAX_AGE_MILLIS,
  HANDLED_ELSEWHERE_RETENTION_MILLIS,
  HEARTBEAT_RETENTION_MILLIS,
  MSG_REMOVAL_DELAY_MILLIS,
} from './constants.ts';
import { iceConfigForNewCall } from './ice-config.ts';
import { AppSettings } from '../../utils/app-settings.ts';
import { replaceSystemNotification } from '../../utils/system-notifications.ts';
import { LOGO_ICON_AS_ARRAY } from '../../../src-main/common/constants/files.ts';
import { makeLogger } from '../../../shared-libs/logger.ts';

const log = makeLogger('VideoChatService');

// How often the watchdog below looks for records and buffered signals that
// outlived their purpose. All the windows it measures against live in
// utils/call-state.ts, next to the rules that use them.
const HEARTBEAT_CLEANUP_INTERVAL = 2_000;

// Buffered non-start WebRTC signals (offer/ICE/disconnect arriving before a
// CallInChat exists) are dropped, and their inbox messages removed, if no
// 'start' shows up to create the call within this window. This protects
// against unbounded memory growth and inbox clutter from truly orphaned
// signals (e.g. a lone leftover ICE candidate for a call whose 'start' was
// already consumed in a previous run).
// Must outlive the recovery it exists for: the request-start round trip is
// two ASMail legs (20-40s+ at measured latency) plus the host's queueing —
// the former 45s routinely expired before the re-sent 'start' arrived.
const PENDING_SIGNAL_TTL_MILLIS = 120_000;

/**
 * Star signal types that only make sense against a call that exists. Arriving
 * with no call, they are the residue of one that is over — never the early
 * signals of one about to start — so they are consumed rather than buffered,
 * and never answered with a 'request-start'.
 */
const TEARDOWN_STAR_SIGNALS: ReadonlySet<string> = new Set([
  'disconnect', 'dropped', 'participant-left', 'call-full',
]);

/** `startedAt` of a 'start', when the sender's build puts one there. */
function startedAtOf(webrtcMsg: WebRTCMsg): number | undefined {
  const data = Array.isArray(webrtcMsg.data) ? webrtcMsg.data[0] : webrtcMsg.data;
  return (typeof data?.startedAt === 'number') ? data.startedAt : undefined;
}

/**
 * Exposes the video GUI opener on IPC. Takes a promise so that exposure can
 * happen at the very start of the component, before the slow storage-touching
 * initialization - the platform gives a caller only 10 seconds to reach an
 * exposed service, and the GUI connects to this one during its own start
 * (see facadeOver in chat-service/ipc-expose.ts).
 */
export function exposeVideoGUIOpenerOnIPC(videoSrv: Promise<VideoChatSrv>): () => void {
  const videoOpenerWrap = new MultiConnectionIPCWrap('VideoGUIOpener');
  const reqReplyMethods: (keyof VideoChatSrv)[] = [
    'startVideoCallForChatRoom',
    'joinOrDismissCallInRoom',
    'endVideoCallInChatRoom',
    'getCallsState',
  ];
  const observableMethods: (keyof VideoChatSrv)[] = ['watchVideoChats'];
  const facade = facadeOver(videoSrv, reqReplyMethods, observableMethods);
  videoOpenerWrap.exposeReqReplyMethods(facade, reqReplyMethods);
  videoOpenerWrap.exposeObservableMethods(facade, observableMethods);
  return videoOpenerWrap.startIPC();
}

export async function videoChatService(
  ownAddr: string,
  chatSrv: ChatSrv,
  db: DB,
  emit: ChatSrvEmit,
  localDataStore: LocalDataStore,
  blacklistTracker?: BlacklistTracker,
): Promise<{ videoChatSrv: VideoChatSrv; stopVideoChatSrv: () => void }> {
  const videoChatsObs = new ObserversSet<VideoChatEvent>();
  const appSettings = new AppSettings();

  /**
   * The state of every chat's call, and every decision that depends on it.
   * Replaces what used to be three registries with overlapping time windows
   * (`activeCallHeartbeats`, `recentlyEndedCalls`, `callsEndedByHost`) plus
   * lifecycle flags read out of CallInChat.
   */
  const sessions = createCallSessions((from, to, chatId) => {
    log.warn(
      `[${ownAddr}] Ignoring call state transition ` +
        `${from ?? 'idle'} -> ${to} for chat ${chatId.chatId}: not allowed`,
    );
  });

  /**
   * Live call objects, so signals can be routed into them. Not a second source
   * of truth about *whether* a call is on - that is `sessions` - just the handle
   * to the object serving the current one.
   *
   * Keyed by chatIdToString(), like the session registry: a chat is identified
   * by the (isGroupChat, chatId) pair, and keying by the bare chatId would let a
   * group chat and a one-to-one chat that share the string collide.
   */
  const calls = new Map<string, CallInChat>();
  // Buffer for WebRTC signals that arrive before CallInChat is initialized.
  // This handles the race where ICE candidates or answers arrive
  // before the start message due to network timing.
  const pendingSignals = new Map<
    string,
    Array<{ sender: string; webrtcMsg: WebRTCMsg; msgId: string; bufferedAt: number }>
  >();

  // Inbox ids of this chat's signalling messages that were handled but left in
  // the inbox: CallInChat returns false for a signal that arrived outside the
  // 'calling' stage, from an unknown client, or when the call was full. Nothing
  // reads them again - the dispatcher's watermark has already passed them - so
  // they are remembered here and dropped in one batch when the call tears down.
  const signalsLeftInInbox = new Map<string, Set<string>>();

  /**
   * Chat history record of the call currently on in each chat, by chatIdToString().
   *
   * Written by doAfterStartCall, read by doAfterEndCall to stamp the duration
   * onto exactly the record this call created, instead of guessing at one. In
   * memory only, and deliberately so: nothing about a call outlives the process
   * that ran it, and pickCallRecordToStamp() falls back on its heuristic for a
   * background process restarted mid-call.
   */
  const callRecordIds = new Map<string, string>();

  /**
   * Call sessions this device has already answered with "I am in this call" (see
   * handleCallHandledElsewhere).
   *
   * A 'call handled elsewhere' notice is sent with a blind repeat, so the same
   * contention arrives twice; without this the reply - which has a blind repeat
   * of its own - would go out twice as well, on a route this app otherwise takes
   * pains to keep clear during a call.
   */
  const answeredAsInCall = new Set<string>();

  /**
   * Rival calls this device has already sent its collision notice to, as
   * `<chatKey>:<rival session>` (see resolveCallCollision). The rival's 'start'
   * comes in up to four copies and its notice in two; one notice from us per
   * rival is all the tie-break needs.
   */
  const collisionNoticesSent = new Set<string>();

  /**
   * When this device last passed a host's heartbeat on to the user's other
   * devices, by chatIdToString() (see shouldRelayRejoinBeat and
   * relayRejoinHeartbeat).
   *
   * The session is kept alongside the time, so that the throttle of one call
   * cannot delay the first relay of the next one: that first relay is the whole
   * point, being what puts the "Join Call" button on a device the host's own
   * messages never reach.
   */
  const lastRejoinRelayAt = new Map<string, { at: number; callSessionId?: string }>();

  function rememberSignalLeftInInbox({ isGroupChat, chatId }: ChatIdObj, msgId: string): void {
    const chatKey = chatIdToString({ isGroupChat, chatId });
    let msgIds = signalsLeftInInbox.get(chatKey);
    if (!msgIds) {
      msgIds = new Set();
      signalsLeftInInbox.set(chatKey, msgIds);
    }
    msgIds.add(msgId);
  }

  /**
   * Logs why an incoming signal is not acted upon. Every dropped signal says
   * which rule dropped it, so "the call never rang" is diagnosable from logs.
   *
   * `important` puts the line at `info`, i.e. into logs of a build with
   * diagnostics off - which is every build a user reports from. It is for the
   * once-per-call lifecycle signals only ('start', 'disconnect',
   * 'call handled elsewhere'): those are what "the phone did not ring on my
   * other device" comes down to, and there are only a couple of them per call.
   * Per-signal traffic (ICE, offers, heartbeats) stays at `debug`.
   */
  function logDroppedSignal(
    verdict: SignalVerdict | CallCancelSysMsgVerdict, what: string, sender: string,
    chatId: ChatIdObj, important = false,
  ): void {
    const msg = `[${ownAddr}] Dropping ${what} from ${sender} for chat `
      + `${chatId.chatId} (${verdict}, call state: ${sessions.state(chatId) ?? 'idle'})`;
    if (important) {
      log.info(msg);
    } else {
      log.debug(msg);
    }
  }

  /**
   * Disposes of a signal this device is not to act on.
   *
   * 'drop-handled-elsewhere' is the one verdict that leaves the message in the
   * inbox: the call is being held on another device of ours, the inbox is
   * shared, and that device is the one the signal is for - removing it here is
   * how it would go missing. Its arrival is also what keeps our record of that
   * session alive, so this device does not later mistake the call's signalling
   * for orphans and ask the host to re-send 'start'.
   *
   * A 'disconnect' of a session we have already finished is taken out with a
   * delay, not at once: our own record says 'ended' because *this* device
   * declined or left, while another device of ours may still be ringing for the
   * very same call and that 'disconnect' is what stops its ringtone (the inbox
   * is shared). The delay is the same idiom as in handleHostEndedRingingCall().
   */
  async function dropSignal(
    verdict: SignalVerdict, what: string, sender: string, chatId: ChatIdObj, msgId: string,
    now: number, opts?: { important?: boolean; stage?: WebRTCMsg['stage'] },
  ): Promise<void> {
    logDroppedSignal(verdict, what, sender, chatId, opts?.important);
    if (verdict === 'drop-handled-elsewhere') {
      sessions.noteSignalOfCallElsewhere(chatId, now);
      return;
    }
    if ((verdict === 'drop-ended-session') && (opts?.stage === 'disconnect')) {
      removeMessageFromInbox(msgId, undefined, MSG_REMOVAL_DELAY_MILLIS).catch(err => {
        w3n.log('error', `Failed to remove dropped 'disconnect' from inbox`, err);
      });
      return;
    }
    removeMessageFromInbox(msgId).catch(err => {
      w3n.log('error', `Failed to remove dropped signal from inbox`, err);
    });
  }

  /**
   * How far back the once-per-session sweep looks. A call cannot last longer
   * than this in practice, so any WebRTC message older than the window belongs
   * to a finished call. Keeps the scan cheap on large inboxes.
   */
  const PURGE_SCAN_BACK_MILLIS = 10 * 60 * 1000;

  /**
   * Delay before the once-per-session sweep runs. The dispatcher that drains
   * missed webrtc-call messages starts after this service (see src-deno/index.ts),
   * and those messages must reach their normal handling first - a 'start' still
   * within its TTL may well be a call the user should see.
   */
  const STARTUP_PURGE_DELAY_MILLIS = 60_000;

  /**
   * Removes signalling messages that this session cannot account for: ones left
   * in the inbox by a previous run, whose ids were never recorded in
   * signalsLeftInInbox and whose dispatcher watermark has already passed them.
   * Nothing else will ever look at them again.
   *
   * Runs once per session rather than on every call teardown, where it used to
   * cost a listMsgs() plus a getMsg() with body decryption per message just to
   * find out which chat each one belonged to. Teardown now drops the ids it
   * recorded while handling the signals.
   *
   * Only messages older than PENDING_SIGNAL_TTL_MILLIS are touched: past that
   * age a signal is ignored by the handling pipeline anyway, so removing it
   * cannot interfere with a call in progress.
   */
  async function purgeStaleWebRTCMessages(): Promise<void> {
    try {
      const now = Date.now();
      const since = Math.max(now - PURGE_SCAN_BACK_MILLIS, 0);
      const list = await w3n.mail!.inbox.listMsgs(since).catch(err => {
        w3n.log('error', `purgeStaleWebRTCMessages: listMsgs failed`, err);
        return undefined;
      });
      if (!list) {
        return;
      }
      const msgIdsToRemove: string[] = [];
      for (const item of list) {
        if (item.msgType !== 'chat' || now - item.deliveryTS <= PENDING_SIGNAL_TTL_MILLIS) {
          continue;
        }
        try {
          const msg = (await w3n.mail!.inbox.getMsg(item.msgId)) as ChatIncomingMessage | undefined;
          if (msg && checkChatMessageJSONforWebRTC(msg, ownAddr)) {
            msgIdsToRemove.push(item.msgId);
          }
        } catch {
          // ignore individual message errors
        }
      }
      if (msgIdsToRemove.length > 0) {
        await removeMessagesFromInboxBatch(
          msgIdsToRemove,
          `[${ownAddr}] Purging stale WebRTC signalling messages left from earlier runs`,
        );
      }
    } catch (err) {
      w3n.log('error', `purgeStaleWebRTCMessages failed`, err);
    }
  }

  const startupPurgeTimer = setTimeout(() => {
    purgeStaleWebRTCMessages().catch(err => {
      log.error('Failed to purge stale WebRTC messages at startup', err);
    });
  }, STARTUP_PURGE_DELAY_MILLIS);

  const sinkGUIEvents = videoChatsObs.next;

  /**
   * OS-level notification shown to a client when the host ends the call.
   * Reaches the user even if the main window is closed (unlike the
   * in-window notice, which is emitted via sinkGUIEvents / VideoChatEvent).
   */
  async function notifyUserOnHostEndedCall(
    { chatId, chatName, hostAddr }: { chatId: ChatIdObj; chatName: string; hostAddr: string; hostName: string },
  ): Promise<void> {
    const icon = Uint8Array.from(LOGO_ICON_AS_ARRAY);
    const title = await appSettings.t('chat.notification.callEndedByHost.title');
    const body = await appSettings.t('chat.notification.callEndedByHost.message', { chatName });

    await replaceSystemNotification({
      icon,
      title: title ?? 'Call Ended',
      body: body ?? '',
      cmd: {
        cmd: 'open-chat-with',
        params: [{ chatId, peerAddress: hostAddr } as OpenChatCmdArg],
      },
    });
  }

  // Periodic cleanup of session records and orphaned buffered signals that
  // outlived their purpose.
  const heartbeatCleanupTimer = setInterval(() => {
    try {
      const now = Date.now();

      // A call that rang unanswered for too long. Normally the host's
      // 'disconnect' ends it, but that message can be consumed from the shared
      // inbox by another of the user's devices - and `ringing` has no other way
      // out (see takeRingingTimeouts), so it used to ring forever. Ended through
      // the ordinary teardown of the live call object, silently: this device
      // never was a participant, so it must send nothing about the call ('not
      // answered' is the host's own timeout to notice). No `reason:
      // 'unanswered-here'` on the GUI event - that one records "the caller
      // cancelled this call" in the chat history, which is not what happened.
      for (const record of sessions.takeRingingTimeouts(now)) {
        const { chatId } = record;
        log.info(
          `[${ownAddr}] Incoming call in chat ${chatId.chatId} rang unanswered for over `
            + `${RINGING_NO_ANSWER_TIMEOUT_MILLIS}ms; giving up on it`,
        );
        const ringingCall = calls.get(chatIdToString(chatId));
        if (ringingCall) {
          ringingCall.end({ silent: true }).catch(err => {
            log.error(`Failed to end ringing call on timeout in chat ${chatId.chatId}`, err);
          });
        } else {
          // Defensive: a `ringing` record should always have a live call behind
          // it; without one there is nothing to tear down, so move the record on
          // directly.
          sessions.transit(chatId, 'ended', now, {
            endedBy: 'self',
            provisional: undefined,
            lastBeat: undefined,
          });
        }
        sinkGUIEvents({ type: 'call-ended', chatId });
      }

      for (const { record, reason } of sessions.takeExpired(now)) {
        log.debug(
          `[${ownAddr}] Dropping ${record.state} record for chat ` +
            `${record.chatId.chatId} (${reason})`,
        );
        // Relaying lives and dies with the record it mirrors: gone the record,
        // gone the throttle, so a later call of this chat starts from a clean
        // slate rather than waiting out an interval measured against a call that
        // is over.
        lastRejoinRelayAt.delete(chatIdToString(record.chatId));
        if (record.state === 'rejoinable') {
          // The "Join Call" button has to go. The chat identity comes from the
          // record itself: a guessed isGroupChat would make the GUI fail to match
          // the chat list item for a 1-1 chat.
          sinkGUIEvents({
            type: 'call-active',
            chatId: record.chatId,
            isCallActive: false,
          });
        }
      }

      // Drop buffered signals for which no 'start' has created a CallInChat
      // within PENDING_SIGNAL_TTL_MILLIS. Without this, a lone/orphaned
      // signal (e.g. a leftover ICE candidate whose matching 'start' was
      // already consumed in a previous run, or a call that was cancelled
      // before any of its signals could be drained) would sit in memory and
      // in the inbox forever, since nothing else ever drains it.
      for (const [chatKey, pending] of pendingSignals.entries()) {
        if (calls.has(chatKey)) {
          continue;
        }
        const fresh = pending.filter(p => now - p.bufferedAt <= PENDING_SIGNAL_TTL_MILLIS);
        const expired = pending.filter(p => now - p.bufferedAt > PENDING_SIGNAL_TTL_MILLIS);
        if (expired.length > 0) {
          log.debug(
            `[${ownAddr}] Dropping ${expired.length} orphaned buffered WebRTC signal(s) ` +
              `for chat ${chatKey} (no 'start' arrived in time)`,
          );
          // Batch-remove all expired orphaned signals from the inbox at once
          // instead of issuing one removeMsg() per signal. This avoids inbox/CPU
          // congestion when many signals accumulate between calls (the "150
          // orphaned buffered" flood seen in logs).
          removeMessagesFromInboxBatch(
            expired.map(p => p.msgId),
            `[${ownAddr}] Batch-removing orphaned WebRTC signals for chat ${chatKey}`,
          );
          if (fresh.length > 0) {
            pendingSignals.set(chatKey, fresh);
          } else {
            pendingSignals.delete(chatKey);
          }
        }
      }
    } catch (err) {
      log.error(`heartbeatCleanupTimer error:`, err);
    }
  }, HEARTBEAT_CLEANUP_INTERVAL);

  /**
   * Post-processing for video chat events.
   * Creates system messages when calls start and updates them when calls end.
   */
  function postProcessingForVideoChat(): {
    doAfterStartCall: (params: {
      chatId: ChatIdObj;
      direction: 'incoming' | 'outgoing';
      sender?: string;
      callSessionId?: string;
    }) => Promise<void>;
    doAfterEndCall: (chatId: ChatIdObj) => Promise<void>;
  } {
    const doAfterStartCall = async ({
      chatId,
      direction,
      sender,
      callSessionId,
    }: {
      chatId: ChatIdObj;
      direction: 'incoming' | 'outgoing';
      sender?: string;
      callSessionId?: string;
    }): Promise<void> => {
      // Derived from the session id when there is one, so that every device of
      // ours that answers this call writes the very same record - two of them
      // answering used to leave two lines about one call, only one of which
      // could ever get the duration (see chatMessageIdForCallEvent).
      const { chatMessageId, timestamp } = callSessionId
        ? {
          chatMessageId: chatMessageIdForCallEvent('call', callSessionId),
          timestamp: Date.now(),
        }
        : generateChatMessageId();

      // A derived id can already be taken: by a re-join of this same session,
      // which comes back through here, or by the phantom of a device that
      // answered before us. addMessage is a bare INSERT, so this is not merely
      // a duplicate line but a primary key violation. The id is remembered
      // either way - the duration has to find this record.
      if (callSessionId && (await db.getMessage({ chatId, chatMessageId }))) {
        callRecordIds.set(chatIdToString(chatId), chatMessageId);
        return;
      }

      const chatSystemData: ChatSystemMessageData = {
        event: 'call',
        value: {
          sender: sender || ownAddr,
          direction,
        },
      };
      const msg: MsgDbEntry = {
        groupChatId: chatId.isGroupChat ? chatId.chatId : null,
        otoPeerCAddr: chatId.isGroupChat ? null : chatId.chatId,
        chatMessageId,
        isIncomingMsg: false,
        incomingMsgId: null,
        groupSender: chatId.isGroupChat ? sender || ownAddr : null,
        body: JSON.stringify(chatSystemData),
        attachments: null,
        chatMessageType: 'system',
        relatedMessage: null,
        status: null,
        timestamp,
        removeAfter: 0,
        history: null,
        reactions: null,
        settings: null,
      };
      await db.addMessage(msg);
      emit.message.added(msg);

      // Remembered so that the end of this call is stamped onto THIS record,
      // rather than onto whichever system record the chat happens to end with
      // (see pickCallRecordToStamp).
      callRecordIds.set(chatIdToString(chatId), chatMessageId);

      // A call record is created purely locally, with nothing sent to peers, so
      // it reaches the user's other devices only through this explicit phantom.
      await chatSrv.syncLocallyMadeSystemEvent(chatId, chatMessageId, chatSystemData);
    };

    const doAfterEndCall = async (chatId: ChatIdObj): Promise<void> => {
      const now = Date.now();
      const chatKey = chatIdToString(chatId);
      const notRegularMsgs = db.getNotRegularMessagesByChat(chatId);
      // Every system record of the chat, in the order the db returned them (that
      // query has no ORDER BY, so it is insertion order): choosing between them
      // is pickCallRecordToStamp's job, and it does not rely on the order.
      const candidates = notRegularMsgs.filter(m => m.chatMessageType === 'system');

      const pick = pickCallRecordToStamp(candidates, now, callRecordIds.get(chatKey));
      // Consumed either way: a call that ended has no further use for its id,
      // and keeping it would let the next call in this chat stamp the wrong one.
      callRecordIds.delete(chatKey);

      if (pick) {
        const { candidate, body } = pick;
        body.value.endTimestamp = now;

        const updatedBody = JSON.stringify(body);
        const updatedMsg = await db.updateMessageRecord(
          { chatId, chatMessageId: candidate.chatMessageId },
          { body: updatedBody },
        );

        emit.message.updated(updatedMsg);

        // Synchronized as a body update: the receiving 'call' branch only ever
        // creates a missing record, it does not update an existing one.
        await chatSrv.syncLocallyMadeSystemEvent(chatId, candidate.chatMessageId, {
          event: 'update:body',
          value: { chatMessageId: candidate.chatMessageId, body: updatedBody },
        });
      } else {
        // A normal outcome, not a loss, and the ordinary way to reach it is a
        // re-join: the record's id is derived from the call session (see
        // doAfterStartCall), so returning to the same call comes back to the
        // SAME record, and a record that already carries an `endTimestamp` is
        // refused by parseCallBody - stamping twice would move the end of a call
        // that is over.
        //
        // What follows from that, and is worth knowing before anyone reads this
        // line as a defect: for a device that left before the call ended, the
        // duration in the chat history is the one of its FIRST stretch. In the
        // run of 2026-08-17 17:07-17:11 that showed as ~48s for the address that
        // left and came back, against the ~3.5 min recorded by the participant
        // who stayed.
        log.info(
          `No unstamped 'call' record to put the duration on in chat ${chatKey}`,
        );
      }

      // Phantoms step aside while a call is on, so this is the moment they were
      // waiting for - and it must not depend on there having been a record to
      // stamp. A call that was declined or never answered has no 'call' record
      // at all, yet it is exactly the call that leaves a phantom behind (the
      // "was cancelled" line), and an early return here left it waiting on the
      // retry timer instead. Not awaited: the release spaces its deliveries
      // out, and the end of a call must not wait on ASMail.
      chatSrv.releasePendingSyncPhantoms().catch(err => log.error(
        `Failed to release sync phantoms held back by the call`, err,
      ));
    };

    return {
      doAfterStartCall,
      doAfterEndCall,
    };
  }

  function nameFromAddr(addr: string): string {
    return addr.indexOf('@') === 0 ? addr : addr.substring(0, addr.indexOf('@'));
  }

  /**
   * The window of a call gets its ICE configuration from here, in
   * `ChatInfoForCall`: STUN/TURN details, credentials among them, belong to this
   * instance and not to a window's bundle (see ice-config.ts).
   */
  async function chatInfoForNewCall(
    chat: ChatDbEntry,
    chatId: ChatIdObj,
    isRejoiningActiveCall = false,
    direction?: 'incoming' | 'outgoing',
    hostAddr?: string,
    callSessionId?: string,
  ): Promise<ChatInfoForCall> {
    const peers = chat.isGroupChat
      ? Object.keys(chat.members)
          .filter(addr => !areAddressesEqual(addr, ownAddr))
          .map(addr => ({ addr, name: nameFromAddr(addr) }))
      : [{ addr: chat.peerAddr, name: chat.name }];

    return {
      chatId,
      ownAddr,
      ownName: nameFromAddr(ownAddr),
      peers,
      chatName: chat.name,
      rtcConfig: await iceConfigForNewCall(),
      isRejoiningActiveCall,
      direction,
      hostAddr,
      callSessionId,
      participantCount: peers.length + 1,
    };
  }

  /**
   * Reads the "please re-send 'start'" request out of a heartbeat body.
   *
   * Accepts both the current shape and the flat one earlier builds sent
   * (`{ requestStart: true, requester }`), so a peer on an older build can
   * still be answered.
   */
  function readRequestStart(
    data: WebRTCOffBandMessage | undefined,
    sender: string,
  ): { requester: string; callSessionId?: string } | undefined {
    const request = data?.requestStart;
    if (!request) {
      return undefined;
    }
    return (request === true)
      ? { requester: data!.requester || sender }
      : { requester: request.requester || sender, callSessionId: request.callSessionId };
  }

  /**
   * Sends a lightweight request to the host to re-send the 'start' signal.
   * Called when we receive orphaned WebRTC signals (ICE candidates, offers)
   * for a chat that has no active CallInChat — this means either the 'start'
   * was lost in ASMail delivery, or we joined late. The host's heartbeat
   * includes hostAddr, so the host may re-send start upon receiving this.
   *
   * `callSessionId` is the session those orphaned signals claim to belong to,
   * so the host can refuse a request about a call that is already over instead
   * of judging it by the request's age.
   */
  async function requestStartRetransmission(
    chatId: ChatIdObj,
    hostAddr: string,
    callSessionId: string | undefined,
  ): Promise<void> {
    const { ok, err } = await sendWebRTCSignal({
      chatId,
      recipient: hostAddr,
      webrtcMsg: {
        stage: 'heartbeat',
        id: Date.now(),
        callSessionId,
        data: { requestStart: { requester: ownAddr, callSessionId } },
      },
      deliveryIdPrefix: 'req-start',
      logLabel: `[${ownAddr}]`,
      signalName: 'request-start',
      confirm: false,
    });
    if (!ok) {
      log.warn(`[${ownAddr}] Failed to send request-start to ${hostAddr}:`, err);
    }
  }

  /**
   * Passes a heartbeat this device has just accepted on to the user's other
   * devices, when the rules of shouldRelayRejoinBeat allow it.
   *
   * The case it covers is a device that receives NOTHING from the host - no
   * 'start', no beat - while its neighbour receives everything, and which
   * therefore never gets a "Join Call" button, however many copies the host
   * sends (run of 2026-08-16, and part II item 7 of the platform report). A
   * message from the user's own address is what such a device does still see.
   *
   * Everything the receiving side needs is already in the beat: `hostAddr` is
   * who to join as a client, and the session id is what tells this call from the
   * next. So the relay only re-addresses what it took, and the ordinary rules
   * then judge it - a neighbour already holding the button gets its record
   * refreshed and no second GUI event, one whose call has ended by the host
   * drops it, one that is in the call drops it too.
   *
   * Fire-and-forget, like everything else on this queue: awaiting a send here
   * would hold up the whole webrtc queue for the delivery.
   */
  function relayBeatToOwnDevices(
    chatId: ChatIdObj,
    chatKey: string,
    hostAddr: string,
    callSessionId: string | undefined,
    beatWasRelayed: boolean,
    now: number,
  ): void {
    const lastRelay = lastRejoinRelayAt.get(chatKey);
    // A throttle recorded against another session says nothing about this one.
    const lastRelayAt = (lastRelay && (lastRelay.callSessionId === callSessionId))
      ? lastRelay.at
      : undefined;
    const relay = shouldRelayRejoinBeat({
      state: sessions.state(chatId),
      inCall: calls.has(chatKey),
      beatWasRelayed,
      lastRelayAt,
      now,
    });
    if (!relay) {
      return;
    }
    lastRejoinRelayAt.set(chatKey, { at: now, callSessionId });
    relayRejoinHeartbeat(
      chatId, ownAddr, localDataStore.getAppDeviceId(), hostAddr, callSessionId,
    ).catch(err => {
      w3n.log('error', `Failed to relay a heartbeat to own devices`, err);
    });
  }

  /**
   * Hands a signal to the call object and disposes of its inbox message.
   *
   * A call that declines the signal (it arrived outside the 'calling' stage,
   * from an unknown client, or the call was full) leaves the message in the
   * inbox. The dispatcher will not offer it again, so its id is remembered for
   * teardown rather than left to be found by a full inbox scan later.
   */
  async function forwardSignalToCall(
    call: CallInChat, chatId: ChatIdObj, sender: string, webrtcMsg: WebRTCMsg, msgId: string,
  ): Promise<void> {
    log.debug(
      `[${ownAddr}] Forwarding signal to CallInChat: sender=${sender}, ` +
        `stage=${webrtcMsg.stage}, hasDescription=` +
        `${!!(webrtcMsg.data && 'description' in webrtcMsg.data && webrtcMsg.data.description)}`,
    );
    if (call.handleWebRTCSignalFrom(sender, webrtcMsg)) {
      if (webrtcMsg.stage === 'start') {
        // A repeat of an invitation this device has already acted upon - and the
        // one message that must not be taken out of the shared inbox early. The
        // repeats exist because a confirmed 'start' can be surfaced by only some
        // of an address's devices (START_REPEAT_DELAYS_MILLIS in _common.ts);
        // removing each copy the moment the ringing device swallows it takes
        // every extra chance away from the device that missed the first one.
        // Left for teardown, exactly like the copy that started the ringing here
        // (see handleIncomingCall).
        rememberSignalLeftInInbox(chatId, msgId);
      } else if (webrtcMsg.stage === 'disconnect') {
        // Deferred, like every other 'disconnect' removal (see dropSignal and
        // handleHostEndedRingingCall): the inbox is shared, and another device
        // of ours may still be ringing for this very call - this message is
        // what stops its ringtone. Taking it out at once was the one path that
        // didn't wait, and the ringing device could miss the end of the call.
        removeMessageFromInbox(msgId, undefined, MSG_REMOVAL_DELAY_MILLIS).catch(err => {
          w3n.log('error', `Failed to remove handled 'disconnect' from inbox`, err);
        });
      } else if (webrtcMsg.stage === 'heartbeat') {
        // Here it feeds this window's host-silence watchdog; on a neighbouring
        // device the same beat is the only thing that can raise a "Join Call"
        // button. One reader, one message, one inbox - so it waits (see
        // HEARTBEAT_RETENTION_MILLIS).
        removeMessageFromInbox(msgId, undefined, HEARTBEAT_RETENTION_MILLIS).catch(err => {
          w3n.log('error', `Failed to remove handled heartbeat from inbox`, err);
        });
      } else {
        // Fire-and-forget: this runs inside the single WebRTC message queue,
        // and awaiting a real inbox round-trip per signal serialized that
        // I/O into the latency of every following signal — client B's offer
        // used to wait behind the removal of client A's ICE candidates.
        removeMessageFromInbox(msgId).catch(err => {
          w3n.log('error', `Failed to remove handled signal from inbox`, err);
        });
      }
    } else {
      rememberSignalLeftInInbox(chatId, msgId);
    }
  }

  function drainPendingSignals(chatId: ChatIdObj, call: CallInChat): void {
    const chatKey = chatIdToString(chatId);
    const pending = pendingSignals.get(chatKey);
    if (!pending) {
      return;
    }
    pendingSignals.delete(chatKey);
    const sessionId = call.getCallSessionId?.();
    for (const { sender, webrtcMsg, msgId } of pending) {
      // A buffered signal of a *different* session than the call that finally
      // showed up cannot belong to it: buffering happens before the session is
      // known, so the buffer may hold stragglers of an earlier call.
      if (sessionId && webrtcMsg.callSessionId && (webrtcMsg.callSessionId !== sessionId)) {
        logDroppedSignal('drop-foreign-session', `buffered '${webrtcMsg.stage}'`, sender, chatId);
        removeMessageFromInbox(msgId);
        continue;
      }
      const removeMsg = call.handleWebRTCSignalFrom(sender, webrtcMsg);
      if (removeMsg) {
        removeMessageFromInbox(msgId);
      } else {
        rememberSignalLeftInInbox(chatId, msgId);
      }
    }
  }

  async function createAndRegisterCall(
    chat: ChatDbEntry,
    chatId: ChatIdObj,
    {
      initialState,
      isRejoiningActiveCall = false,
      direction,
      hostAddr,
      callSessionId,
      startedAt,
    }: {
      /** State the chat enters as this call is created. */
      initialState: CallState;
      isRejoiningActiveCall?: boolean;
      direction?: 'incoming' | 'outgoing';
      hostAddr?: string;
      callSessionId?: string;
      /** When the host sent its 'start'; kept for the collision tie-break. */
      startedAt?: number;
    },
  ): Promise<CallInChat> {
    const chatKey = chatIdToString(chatId);
    const callInfo = await chatInfoForNewCall(
      chat, chatId, isRejoiningActiveCall, direction, hostAddr, callSessionId,
    );
    const call = callInChat({
      info: callInfo,
      sinkGUIEvents,
      notifyUserOnHostEndedCall,
      notifyState: state => {
        if (calls.get(chatKey) === call) {
          sessions.transit(chatId, state, Date.now());
        }
      },
      detachFromParent: endState => {
        if (calls.get(chatKey) === call) {
          calls.delete(chatKey);
          // Clean up this chat's signalling messages from the inbox so they
          // don't accumulate between calls (the "150 orphaned buffered" flood
          // seen in logs) or trigger a spurious request-start / re-ring on the
          // next call: the ones still buffered, plus the ones that were handled
          // but deliberately left in the inbox.
          const pending = pendingSignals.get(chatKey);
          const leftInInbox = signalsLeftInInbox.get(chatKey);
          const msgIdsToRemove = [
            ...(pending?.map(p => p.msgId) ?? []),
            ...(leftInInbox ?? []),
          ];
          if (msgIdsToRemove.length > 0) {
            removeMessagesFromInboxBatch(
              msgIdsToRemove,
              `[${ownAddr}] Removing WebRTC signals for chat ${chatKey} on teardown`,
            );
          }
          pendingSignals.delete(chatKey);
          signalsLeftInInbox.delete(chatKey);
          // Keyed by session, so a stale entry could never mislead the next
          // call - it is dropped here only to keep the set from growing over
          // the lifetime of the component.
          for (const key of answeredAsInCall) {
            if (key.startsWith(`${chatKey}:`)) {
              answeredAsInCall.delete(key);
            }
          }
          for (const key of collisionNoticesSent) {
            if (key.startsWith(`${chatKey}:`)) {
              collisionNoticesSent.delete(key);
            }
          }

          const now = Date.now();
          // The call object is gone after this block, so the record must not
          // stay in a live state whatever the transition table says: a live
          // record with no call behind it blocks resync, the "Join Call"
          // button and any new call in this chat until a service restart.
          // On refusal, drop the record and apply the terminal state from
          // idle ('rejoinable' is an entry state and passes; 'ended' from
          // idle is refused, which leaves clean idle - equally safe).
          const transitToTerminal = (
            target: CallState, patch: CallSessionPatch,
          ): void => {
            if (sessions.transit(chatId, target, now, patch)) {
              return;
            }
            log.warn(
              `[${ownAddr}] Detach of call in ${chatId.chatId} could not record `
                + `'${target}' - dropping the session record instead`,
            );
            sessions.drop(chatId);
            sessions.transit(chatId, target, now, patch);
          };
          if (endState.kind === 'rejoinable') {
            // We left a group call that keeps running without us. Offer the
            // "Join Call" button right away instead of waiting for the host's
            // heartbeat to make a full round trip. Marked provisional: a real
            // heartbeat must confirm it, otherwise the watchdog drops it on
            // the shorter PROVISIONAL_REJOIN_TIMEOUT.
            transitToTerminal('rejoinable', {
              hostAddr: endState.hostAddr,
              callSessionId,
              lastBeat: now,
              provisional: true,
              endedBy: undefined,
            });
            sinkGUIEvents({
              type: 'call-active',
              chatId,
              isCallActive: true,
              reason: 'self-left',
            });
            // And the user's other devices are told, because one of them may be
            // holding its "Join Call" button down on our account: a device that
            // yielded this call to us keeps it down for as long as we are in it
            // (see admitsHeartbeat). Nothing else would lift that in time - the
            // host's heartbeats say a call is on, not who of this user's devices
            // is in it. A lost notice costs no more than the wait for the record
            // to expire, which is what used to happen always.
            sendCallHandledElsewhere(
              chatId, ownAddr, localDataStore.getAppDeviceId(), true, callSessionId,
              undefined, true,
            ).catch(err => {
              w3n.log('error', `Failed to tell own devices that this call was left here`, err);
            });
          } else {
            // The call is over. `endedBy: 'host'` is what makes a heartbeat of
            // this same session still in flight get ignored, instead of giving
            // us a "Join Call" button for a call that is over.
            transitToTerminal('ended', {
              hostAddr: endState.hostAddr,
              callSessionId,
              endedBy: (endState.kind === 'ended-by-host')
                ? 'host'
                : ((endState.kind === 'ended-by-peer') ? 'peer' : 'self'),
              provisional: undefined,
              lastBeat: undefined,
            });
          }
        }
      },
      postProcessingForVideoChat,
      onCollisionUnresolved: rival => reportFailedCallCollision(
        chatId, rival, callInfo.callSessionId,
      ),
    });

    calls.set(chatKey, call);
    sessions.transit(chatId, initialState, Date.now(), {
      role: (direction === 'outgoing') ? 'host' : 'client',
      hostAddr,
      callSessionId,
      startedAt,
      endedBy: undefined,
      provisional: undefined,
    });
    drainPendingSignals(chatId, call);
    return call;
  }


  async function handleIncomingCall(
    chat: ChatDbEntry,
    chatId: ChatIdObj,
    peer: string,
    webrtcMsg: WebRTCMsg,
    msgId: string | undefined,
    { showIncomingUI = true }: {
      /**
       * False when this device is about to join the call on its own, without
       * the user's answer (see yieldToRivalCall): the user already asked for a
       * call in this chat, and Join/Decline buttons for it would only get in
       * the way.
       */
      showIncomingUI?: boolean;
    } = {},
  ): Promise<void> {
    // At `info`, in two lines around startAppWithParams(), because "it only rang
    // on one of my devices" is answered by which of them is missing: the first
    // says this device accepted the call and is ringing, the second that it asked
    // the shell for the incoming-call UI. If both are there and no buttons showed
    // up, the fault is past this service - in the command's route into the chat
    // list (see the matching line in useChatView.ts).
    log.info(
      `[${ownAddr}] Incoming call in chat ${chatId.chatId} (isGroup: ${chatId.isGroupChat}) `
        + `from ${peer}, session ${webrtcMsg.callSessionId ?? 'n/a'}, `
        + `signal age ${Date.now() - webrtcMsg.id}ms; ringing here`,
    );

    // For incoming calls: direction='incoming', hostAddr=peer (the caller).
    // The session id comes from the 'start' itself: it is the host's, and every
    // signal we send for this call echoes it back.
    const call = await createAndRegisterCall(chat, chatId, {
      initialState: 'ringing',
      direction: 'incoming',
      hostAddr: peer,
      callSessionId: webrtcMsg.callSessionId,
      startedAt: startedAtOf(webrtcMsg),
    });
    call.handleWebRTCSignalFrom(peer, webrtcMsg);

    // The 'start' stays in the shared inbox for the user's other devices to
    // ring from, but it must not outlive the call: teardown drops the ids
    // remembered here (see signalsLeftInInbox). Before this, an accepted
    // call's 'start' was never removed at all, and its replay - by a later
    // catch-up scan or with a skewed sender clock - re-opened the incoming
    // call UI for a call that was long over.
    if (msgId) {
      rememberSignalLeftInInbox(chatId, msgId);
    }

    if (!showIncomingUI) {
      return;
    }

    const cmdArg: IncomingCallCmdArg = {
      chatId,
      peerAddress: peer,
      callSessionId: webrtcMsg.callSessionId,
      sentAt: Date.now(),
    };
    // Caught here rather than by the caller's catch-all: a failure of this one
    // call means the call rings nowhere, and that has to be named as such.
    try {
      await w3n.shell!.startAppWithParams!(null, 'incoming-call', cmdArg);
      log.info(`[${ownAddr}] Incoming-call UI requested for chat ${chatId.chatId}`);
    } catch (err) {
      log.error(
        `[${ownAddr}] Failed to open the incoming-call UI for chat ${chatId.chatId}: `
          + `the call is ringing with no Join/Decline buttons`,
        err,
      );
    }
  }

  /**
   * Two calls in one chat: ours, which we host and nobody may have answered
   * yet, and the rival's, of which we just learned - by its 'start' or by its
   * host's collision notice. Settles which of the two stays (the rule and its
   * reasons: callCollisionWinner in call-state.ts) and acts on it here.
   *
   * Until this existed, the rival's 'start' went into our host call object,
   * which has nothing to do with a 'start', and both people stared at
   * "Calling..." until the no-answer timeout - each waiting for an offer from the
   * other, which neither was ever going to send.
   */
  async function resolveCallCollision(
    chat: ChatDbEntry,
    chatId: ChatIdObj,
    call: CallInChat,
    rival: CallCollisionParty,
    startMsgId: string | undefined,
  ): Promise<void> {
    const chatKey = chatIdToString(chatId);
    const own: CallCollisionParty = {
      hostAddr: ownAddr,
      callSessionId: call.getCallSessionId?.(),
      startedAt: call.getStartedAt?.(),
      established: !!call.isEstablished?.(),
    };

    // Still on the media setup screen: nobody has been invited, so there is
    // nothing to weigh and nobody to tell. The rival will see us arrive as an
    // ordinary client.
    const notStartedYet = (own.startedAt === undefined) && !own.established;
    const winner = notStartedYet ? 'b' : callCollisionWinner(own, rival);
    log.info(
      `[${ownAddr}] Calls collide in chat ${chatId.chatId}: ours (session `
        + `${own.callSessionId ?? 'n/a'}, started ${own.startedAt ?? 'not yet'}, `
        + `established ${own.established}) and ${rival.hostAddr}'s (session `
        + `${rival.callSessionId ?? 'n/a'}, started ${rival.startedAt ?? 'unknown'}, `
        + `established ${rival.established}); ${winner === 'a' ? 'ours' : 'theirs'} stays`,
    );

    // Ours went out, so the rival has it or will: our facts go along, as the
    // rival cannot otherwise know whether someone has answered us since.
    const noticeKey = `${chatKey}:${rival.callSessionId ?? rival.hostAddr}`;
    if (!notStartedYet && !collisionNoticesSent.has(noticeKey)) {
      collisionNoticesSent.add(noticeKey);
      sendCallCollision(chatId, rival.hostAddr, ownAddr, own.callSessionId, {
        startedAt: own.startedAt, established: own.established,
      }).catch(err => {
        w3n.log('error', `Failed to tell ${rival.hostAddr} of the colliding call`, err);
      });
    }

    if ((winner === 'a') || own.established) {
      // Someone is already in our call: it is not ours to give up, even if the
      // rival is too and started first. The two calls then go on apart, and the
      // timer below is what says so to the user.
      call.noteCollisionWon?.(rival.hostAddr, rival.callSessionId);
      if (startMsgId) {
        rememberSignalLeftInInbox(chatId, startMsgId);
      }
      return;
    }

    await yieldToRivalCall(chat, chatId, call, rival, startMsgId);
  }

  /**
   * Withdraws our call in favour of the rival's and joins that one as a client.
   * Everything after the withdrawal is the ordinary path of an answered call:
   * the same record, the same window, the same notice to our other devices.
   */
  async function yieldToRivalCall(
    chat: ChatDbEntry,
    chatId: ChatIdObj,
    call: CallInChat,
    rival: CallCollisionParty,
    startMsgId: string | undefined,
  ): Promise<void> {
    const chatKey = chatIdToString(chatId);
    if (!call.yieldToRivalCall) {
      return;
    }

    // The outgoing record our call put into the history is taken back: that
    // call never ran, and the call we are joining makes a record of its own.
    const ownRecordId = callRecordIds.get(chatKey);
    callRecordIds.delete(chatKey);
    const dropOwnRecord = () => {
      if (ownRecordId) {
        chatSrv.deleteMessage({ chatId, chatMessageId: ownRecordId }, false).catch(err => {
          w3n.log('error', `Failed to remove the record of a withdrawn call`, err);
        });
      }
    };
    const winner = {
      hostAddr: rival.hostAddr,
      callSessionId: rival.callSessionId,
      startedAt: rival.startedAt,
    };

    // In place first: the window stays, with the devices the user picked, and
    // only changes sides. The call window says so itself, so the main window
    // has nothing to add.
    if (await call.switchToClientOf?.(winner)) {
      sessions.transit(chatId, 'connecting', Date.now(), {
        role: 'client',
        hostAddr: rival.hostAddr,
        callSessionId: rival.callSessionId,
        startedAt: rival.startedAt,
      });
      if (startMsgId) {
        rememberSignalLeftInInbox(chatId, startMsgId);
      }
      dropOwnRecord();
      // What answering an incoming call does (joinOrDismissCallInRoom): our
      // other devices stop ringing for this call, and the history gets the
      // record of it.
      sendCallHandledElsewhere(
        chatId, ownAddr, localDataStore.getAppDeviceId(), true, rival.callSessionId,
      ).catch(err => {
        w3n.log('error', `Failed to tell own devices that the call was taken here`, err);
      });
      const { doAfterStartCall } = postProcessingForVideoChat();
      await doAfterStartCall({
        chatId, direction: 'incoming', sender: rival.hostAddr, callSessionId: rival.callSessionId,
      });
      return;
    }

    // The window could not be asked: close it and open a client one, the way
    // an answered incoming call opens.
    log.info(
      `[${ownAddr}] Could not switch the call window in chat ${chatId.chatId} in place; `
        + `reopening it as a client of ${rival.hostAddr}`,
    );
    await call.yieldToRivalCall(winner);
    dropOwnRecord();

    sinkGUIEvents({
      type: 'call-collision',
      chatId,
      peerAddr: rival.hostAddr,
      collisionOutcome: 'joining',
    });

    const startMsg: WebRTCMsg = {
      stage: 'start',
      id: Date.now(),
      callSessionId: rival.callSessionId,
      data: (typeof rival.startedAt === 'number') ? { startedAt: rival.startedAt } : {},
    };
    await handleIncomingCall(chat, chatId, rival.hostAddr, startMsg, startMsgId, {
      showIncomingUI: false,
    });
    await joinOrDismissCallInRoom(chatId, true, rival.hostAddr, rival.callSessionId);
  }

  /**
   * Puts "the call with X did not take place - you were calling each other at
   * the same moment" into this chat's history, and onto the user's other
   * devices.
   *
   * The record names the other side (`sender`) and that side's call, and its id
   * is derived from both, so every device of ours that writes it - from its own
   * timer, from the rival's system message, from a phantom - writes the same
   * one, and a second write is a no-op.
   */
  async function recordFailedCallCollision(
    chatId: ChatIdObj, otherAddr: string, otherSessionId: string | undefined,
  ): Promise<void> {
    const chatSystemData: ChatSystemMessageData = {
      event: 'webrtc-call',
      value: {
        sender: otherAddr,
        subType: 'call-collision-failed',
        chatId,
        callSessionId: otherSessionId,
      },
    };
    const { chatMessageId, timestamp } = otherSessionId
      ? {
        chatMessageId: chatMessageIdForCallEvent('call-collision-failed', otherSessionId, otherAddr),
        timestamp: Date.now(),
      }
      : generateChatMessageId();
    if (otherSessionId && (await db.getMessage({ chatId, chatMessageId }))) {
      return;
    }
    const msg: MsgDbEntry = {
      groupChatId: chatId.isGroupChat ? chatId.chatId : null,
      otoPeerCAddr: chatId.isGroupChat ? null : chatId.chatId,
      chatMessageId,
      isIncomingMsg: false,
      incomingMsgId: null,
      groupSender: chatId.isGroupChat ? otherAddr : null,
      body: JSON.stringify(chatSystemData),
      attachments: null,
      chatMessageType: 'system',
      relatedMessage: null,
      status: null,
      timestamp,
      removeAfter: 0,
      history: null,
      reactions: null,
      settings: null,
    };
    await db.addMessage(msg);
    emit.message.added(msg);
    // Only with a derived id, for the reason given at recordCallEvent in the
    // GUI's chats.store.ts: a generated one cannot be agreed upon, and the
    // other devices would end up with a second line about one failure.
    if (otherSessionId) {
      await chatSrv.syncLocallyMadeSystemEvent(chatId, chatMessageId, chatSystemData);
    }
  }

  /**
   * Our call won a collision, and the other host never came in (see
   * noteCollisionWon in call.ts): a build that cannot step aside, a notice lost
   * on the way, or both calls already answered. Said in three places, because
   * each reaches someone the others do not: a notice for the user looking at
   * the screen now, a record in our history, and a system message that puts
   * the same record into the rival's history - its call went nowhere as well.
   */
  function reportFailedCallCollision(
    chatId: ChatIdObj,
    rival: { hostAddr: string; callSessionId?: string },
    ownSessionId: string | undefined,
  ): void {
    sinkGUIEvents({
      type: 'call-collision',
      chatId,
      peerAddr: rival.hostAddr,
      collisionOutcome: 'unresolved',
    });
    recordFailedCallCollision(chatId, rival.hostAddr, rival.callSessionId).catch(err => {
      w3n.log('error', `Failed to record the failed call collision in chat ${chatId.chatId}`, err);
    });
    sendSystemMsgAboutFailedCallCollision({
      ownAddr, chatId, rivalHostAddr: rival.hostAddr, callSessionId: ownSessionId,
    }).catch(err => {
      w3n.log('error', `Failed to tell ${rival.hostAddr} that the calls did not meet`, err);
    });
  }

  /**
   * The rival host's collision notice. It may come before its 'start' - both
   * travel separately - or after we have settled on its 'start' alone; either
   * way the decision is taken again with the one fact only the notice carries,
   * `established`.
   */
  async function handleCallCollisionNotice(
    chat: ChatDbEntry,
    chatId: ChatIdObj,
    sender: string,
    webrtcMsg: WebRTCMsg,
    notice: NonNullable<WebRTCOffBandMessage['callCollision']>,
    msgId: string,
  ): Promise<void> {
    removeMessageFromInbox(msgId).catch(err => {
      w3n.log('error', `Failed to remove a collision notice from inbox`, err);
    });
    const call = calls.get(chatIdToString(chatId));
    const ownSession = call?.getCallSessionId?.();
    const ownState = sessions.state(chatId);
    if (!call || (call.getRole?.() !== 'host') || !ownState || !isSignallingState(ownState)
      || (webrtcMsg.callSessionId && ownSession && (webrtcMsg.callSessionId === ownSession))) {
      // No call of ours to weigh against theirs: we have already joined it,
      // or ours is over. Nothing to do.
      log.info(
        `[${ownAddr}] Collision notice from ${sender} in chat ${chatId.chatId}: `
          + `no call of ours hosted here (role: ${call?.getRole?.() ?? 'none'}); ignoring`,
      );
      return;
    }
    await resolveCallCollision(chat, chatId, call, {
      hostAddr: sender,
      callSessionId: webrtcMsg.callSessionId,
      startedAt: notice.startedAt,
      established: !!notice.established,
    }, undefined);
  }

  /**
   * Another device of this same user answered or declined the call that is
   * ringing here too (every device of a user gets the 'start': an ASMail inbox
   * belongs to the user, not to a device).
   *
   * Ends the local call *silently*. The host keys peers by address, so a
   * 'disconnect' or 'call-declined' sent from here would be read as coming from
   * the device that actually joined - in a 1-1 chat that tears down the live
   * call, in a group one it marks the participant as having declined.
   *
   * `chatId` comes from the message body, not from its envelope: the sender is
   * this very user, and a one-to-one chat derived from that would be the chat
   * with oneself (see ChatWebRTCMsgV1.chatId).
   *
   * Whether this device steps out is decided by callHandledElsewhereOutcome()
   * in call-state.ts: ringing here means yielding outright, and a device that
   * has answered too - the notice takes seconds to arrive, so both users' clicks
   * fit inside that window - is settled by a tie-break that exactly one of the
   * two loses.
   */
  async function handleCallHandledElsewhere(
    chatId: ChatIdObj,
    webrtcMsg: WebRTCMsg,
    handled: NonNullable<WebRTCOffBandMessage['callHandledElsewhere']>,
    msgId: string,
  ): Promise<void> {
    // Deferred removal, throughout this function and never awaited: the inbox is
    // shared, so taking the message out right away would take it from the very
    // devices it was sent for - including one that is still starting up and will
    // only find it in its catch-up scan. Awaiting it would stall the whole
    // webrtc queue for the delay, as it is one SingleProc.
    const dropMessageLater = () => {
      removeMessageFromInbox(msgId, undefined, HANDLED_ELSEWHERE_RETENTION_MILLIS).catch(err => {
        w3n.log('error', `Failed to remove 'call handled elsewhere' message from inbox`, err);
      });
    };

    if (handled.deviceId === localDataStore.getAppDeviceId()) {
      // Our own copy - delivery to one's own address comes back to the sender
      // too.
      dropMessageLater();
      return;
    }

    const now = Date.now();
    const record = sessions.get(chatId);
    const call = calls.get(chatIdToString(chatId));

    // Nothing to step out of, and deliberately *not* recording an 'ended'
    // session either: such a record would suppress the signals of the *next*
    // call for RECENTLY_ENDED_COOLDOWN_MILLIS / ENDED_SESSION_RETENTION_MILLIS.
    // This is also what keeps a device that connects days later from being
    // misled - it has no call at all, so the notice is a no-op for it.
    //
    // This branch comes BEFORE the `left` handling below, and that is on
    // purpose, though the run of 2026-08-16 shows what it costs: the device
    // that never saw the call (nothing from the host reached it) did receive
    // this notice - own address - and dropped it here, having no record. It
    // cannot be helped from here. A `left` notice says its sender is out of a
    // call; it does not say the call is still on, nor who hosts it, and both
    // are needed to offer a button that leads anywhere. What such a device
    // needs is a live beat, which is what relayBeatToOwnDevices sends it.
    if (!record) {
      log.info(`[${ownAddr}] Ignoring 'call handled elsewhere' for ${chatId.chatId}: no call here`);
      dropMessageLater();
      return;
    }
    if (webrtcMsg.callSessionId && record.callSessionId
      && (webrtcMsg.callSessionId !== record.callSessionId)) {
      logDroppedSignal(
        'drop-foreign-session', `'call handled elsewhere'`, ownAddr, chatId, true,
      );
      dropMessageLater();
      return;
    }
    if (!webrtcMsg.callSessionId
      && ((now - webrtcMsg.id) > HANDLED_ELSEWHERE_MAX_AGE_MILLIS)) {
      // No session id to judge by (a build that predates the field), so age is
      // all there is: a notification this old cannot be about the call ringing
      // here now.
      logDroppedSignal('drop-stale', `'call handled elsewhere'`, ownAddr, chatId, true);
      dropMessageLater();
      return;
    }

    // The device that was holding this call has left it, so our hold on the
    // "Join Call" button goes with it: this call is ours to join now.
    //
    // The button goes up here rather than on the host's next heartbeat, because
    // that beat is not ours alone to wait for: it lands in the shared inbox,
    // where the device that just left - which keeps its own record alive with
    // the very same beats - reads it too (live run of 2026-08-16: it read every
    // one of them and this device never got a button). What we have in hand is
    // enough: this notice says the call goes on without the device that was in
    // it, and the record already names the host and the session. Provisional, so
    // it is the ordinary re-join promise: a real heartbeat confirms it, and
    // failing that it expires on PROVISIONAL_REJOIN_TIMEOUT and the button goes
    // away by itself.
    if (handled.left) {
      if ((record.state === 'ended') && (record.endedBy === 'other-device')) {
        const callSessionId = record.callSessionId ?? webrtcMsg.callSessionId;
        // Whom this button would join, worked out here rather than left to the
        // moment it is pressed: a "Join Call" that cannot name a host is a
        // promise this device has no way of keeping (see rejoinTargetOf). The
        // session id is the second place the host is written down, and taking
        // it from there also repairs a record that lost the field.
        const hostAddr = record.hostAddr || hostAddrOfCallSession(callSessionId);
        if (!hostAddr) {
          log.info(
            `[${ownAddr}] Device ${handled.deviceId} left the call in ${chatId.chatId}, but `
              + `nothing here names its host - not offering to join it`,
          );
          dropMessageLater();
          return;
        }
        log.info(
          `[${ownAddr}] Device ${handled.deviceId} left the call in ${chatId.chatId}; `
            + `this device may join it again (host: ${hostAddr})`,
        );
        sessions.transit(chatId, 'rejoinable', now, {
          role: 'client',
          hostAddr,
          callSessionId,
          lastBeat: now,
          provisional: true,
          endedBy: undefined,
        });
        sinkGUIEvents({
          type: 'call-active',
          chatId,
          isCallActive: true,
        });
      }
      dropMessageLater();
      return;
    }

    const outcome = callHandledElsewhereOutcome({
      state: record.state,
      joinedThere: handled.joined,
      otherInCall: !!handled.inCall,
      ownDeviceId: localDataStore.getAppDeviceId(),
      otherDeviceId: handled.deviceId,
    });

    if (outcome === 'drop-rejoin-offer') {
      // The mirror image of the `left` branch above: that one puts the button up
      // when a neighbour leaves the call, this one takes it down when a
      // neighbour enters it. `endedBy: 'other-device'` is the same hold that a
      // device which yielded a ringing call keeps - the host's heartbeats do not
      // raise the button again while it stands (admitsHeartbeat), and the
      // neighbour's own `left` notice lifts it the moment that device is out.
      log.info(
        `[${ownAddr}] Device ${handled.deviceId} has joined the call in ${chatId.chatId}; `
          + `taking the "Join Call" button down here`,
      );
      sessions.transit(chatId, 'ended', now, {
        endedBy: 'other-device',
        lastSignal: now,
        provisional: undefined,
        lastBeat: undefined,
      });
      sinkGUIEvents({
        type: 'call-active',
        chatId,
        isCallActive: false,
      });
      dropMessageLater();
      return;
    }

    if (outcome === 'keep') {
      log.info(
        `[${ownAddr}] Keeping the call in ${chatId.chatId} despite device ${handled.deviceId} `
          + `having ${handled.joined ? 'answered' : 'declined'} it (state here: ${record.state})`,
      );
      const sessionKey = `${chatIdToString(chatId)}:${record.callSessionId ?? ''}`;
      if ((record.state === 'active') && handled.joined && !handled.inCall
        && !answeredAsInCall.has(sessionKey)) {
        // The other device is still setting up while this one is already in the
        // call, and the tie-break alone might hand the call to it. Sent only on
        // this branch: with a single device answering, which is every ordinary
        // call, nothing extra goes on the wire.
        answeredAsInCall.add(sessionKey);
        sendCallHandledElsewhere(
          chatId, ownAddr, localDataStore.getAppDeviceId(), true, record.callSessionId, true,
        ).catch(err => {
          w3n.log('error', `Failed to tell own device that the call is already going on here`, err);
        });
      }
      dropMessageLater();
      return;
    }

    log.info(`[${ownAddr}] Call in ${chatId.chatId} was ${handled.joined ? 'answered' : 'declined'} on device ${handled.deviceId}; stopping here`);

    if (call) {
      // The window goes too, and nothing goes out: this device may be sitting on
      // the media setup screen, and that screen sends its offer straight over
      // ASMail - an open window is a call it can still join. Silent because the
      // host keys peers by address, so a 'disconnect' from here would end the
      // call for the device that won it.
      await call.stepAsideForOwnDevice();
    }

    // 'other-device' rather than 'self': the call is not over, it is being held
    // elsewhere, and its signalling keeps arriving here (the inbox is shared).
    // That distinction is what stops this device from consuming those signals,
    // from taking them out of the inbox, and - via `lastSignal` - from forgetting
    // the session while the call is still going. Forgetting it was what made this
    // device ask the host to re-send 'start' and start ringing mid-call.
    //
    // Set after end(), whose detach path records 'ended' with `endedBy: 'self'`:
    // 'ended' -> 'ended' is allowed and keeps `since`.
    sessions.transit(chatId, 'ended', now, {
      endedBy: 'other-device',
      lastSignal: now,
      provisional: undefined,
      lastBeat: undefined,
    });

    // The GUI uses it to drop the incoming-call state, which is what silences
    // the ringtone. The reason is what tells the user why: a ringtone stopping
    // by itself needs no explanation, but a media setup screen closing under
    // the user's hands does.
    sinkGUIEvents({ type: 'call-ended', chatId, reason: 'answered-elsewhere' });

    dropMessageLater();
  }

  /**
   * The host cancelled or ended a call that is still ringing on this device:
   * the user has not answered here, so this device is not a participant.
   *
   * `ringing` is the one live state whose end nothing else here would learn
   * about: an answered call winds its own window down, a declined one is
   * already over. Without this, a 'disconnect' arriving in `ringing` is
   * declined by the call object (callStage is still 'not-started') and the
   * ringtone plays on.
   */
  async function handleHostEndedRingingCall(
    chatId: ChatIdObj,
    hostAddr: string,
    callSessionId: string | undefined,
    call: CallInChat,
    msgId: string,
  ): Promise<void> {
    log.info(`[${ownAddr}] Host ${hostAddr} ended the call ringing in ${chatId.chatId}; stopping here`);

    // Silent: peers are keyed by address, so a 'disconnect' from here would be
    // read as coming from whichever device of ours is actually in the call - in
    // a 1-1 chat that tears down a live call.
    await call.end({ silent: true });

    // end(), told to keep quiet, has no way to know who ended the call, and
    // that matters: `endedBy: 'host'` is what stops a heartbeat of this same
    // session, still in flight, from offering a "Join Call" button for a call
    // that is over. 'ended' -> 'ended' is allowed and keeps `since`, so the
    // retention window does not slide.
    sessions.transit(chatId, 'ended', Date.now(), {
      hostAddr,
      callSessionId,
      endedBy: 'host',
      provisional: undefined,
      lastBeat: undefined,
    });

    // No call window on this device, so nothing else emits this; the GUI drops
    // the incoming-call state on it, which is what silences the ringtone.
    // 'call-ended-by-host' would be wrong here: it announces "the host ended
    // the call" to someone who never was in it.
    //
    // `reason` matters: this arrives ahead of the host's
    // 'outgoing-call-cancelled' system message (signalling is sent
    // out-of-queue, that message is not), and the GUI needs to know that the
    // call it is clearing was never answered here - otherwise the cancelled
    // call would be missing from the chat history.
    sinkGUIEvents({
      type: 'call-ended',
      chatId,
      peerAddr: hostAddr,
      reason: 'unanswered-here',
    });

    // Deferred and not awaited: another device of ours may be in this very call
    // and still need this 'disconnect' (the inbox is shared).
    removeMessageFromInbox(msgId, undefined, MSG_REMOVAL_DELAY_MILLIS).catch(err => {
      w3n.log('error', `Failed to remove handled 'disconnect' from inbox`, err);
    });
  }

  async function handleIncomingWebRTCMsg(msg: ChatIncomingMessage): Promise<void> {
    const { sender, msgId } = msg;
    const checkMsgBody = checkChatMessageJSONforWebRTC(msg, ownAddr);
    if (!checkMsgBody) {
      // Deferred when it came from a device of ours, and never awaited: the
      // inbox is shared, so an immediate removal takes the message from our
      // other devices, and awaiting the delay would stall the webrtc queue.
      if (areAddressesEqual(sender, ownAddr)) {
        removeMessageFromInbox(
          msgId,
          `Incoming WebRTC chat message ${msgId} from own device failed body check. Removing it from inbox.`,
          HANDLED_ELSEWHERE_RETENTION_MILLIS,
        ).catch(err => w3n.log('error', `Failed to remove own malformed WebRTC message`, err));
        return;
      }
      removeMessageFromInbox(
        msgId,
        `Incoming WebRTC chat message ${msgId} failed body check. Removing it from inbox.`,
      ).catch(err => w3n.log('error', `Failed to remove malformed WebRTC message`, err));
      return;
    }

    if (blacklistTracker && !areAddressesEqual(sender, ownAddr) && blacklistTracker.isBlacklisted(sender)) {
      removeMessageFromInbox(
        msgId,
        `Incoming WebRTC message ${msgId} is from blacklisted sender ${sender}. Removing it from inbox.`,
      ).catch(err => w3n.log('error', `Failed to remove blacklisted WebRTC message ${msgId}`, err));
      return;
    }

    const { chatId, webrtcMsg, fromOwnDevice } = checkMsgBody;
    const chatKey = chatIdToString(chatId);
    const firstBodyItem = Array.isArray(webrtcMsg.data) ? webrtcMsg.data[0] : webrtcMsg.data;

    // Signals that happen once per call are logged at `info`, so that a build
    // with diagnostics off still shows how a call began and ended. The traffic
    // that makes up the bulk of signalling - heartbeats, offers/answers, ICE
    // candidates - stays at `debug`.
    const isLifecycleSignal = (webrtcMsg.stage === 'start')
      || (webrtcMsg.stage === 'disconnect')
      || !!firstBodyItem?.callDeclined
      || !!firstBodyItem?.callHandledElsewhere
      || !!firstBodyItem?.callCollision
      || !!firstBodyItem?.callFull;
    const incomingMsgLine = `[${ownAddr}] Incoming WebRTC msg from ${sender}, stage: ${webrtcMsg.stage}, chatId: ${chatId.chatId}, isGroup: ${chatId.isGroupChat}, ownDevice: ${fromOwnDevice}`;
    if (isLifecycleSignal) {
      log.info(incomingMsgLine);
    } else {
      log.debug(incomingMsgLine);
    }

    // Addressed to ourselves by another device of ours: not a call signal at
    // all, so it is taken before every gate below - including the chat lookup,
    // which reasons about a chat with a peer. Its `chatId` comes from the body
    // (see ChatWebRTCMsgV1.chatId): there is no peer address in the envelope to
    // derive a one-to-one chat from, only our own.
    if (firstBodyItem?.callHandledElsewhere && fromOwnDevice) {
      return await handleCallHandledElsewhere(
        chatId, webrtcMsg, firstBodyItem.callHandledElsewhere, msgId,
      );
    }

    const chat = chatSrv.findChatEntry(chatId);
    if (!chat) {
      if (fromOwnDevice) {
        // A device of ours on a build that predates `chatId` in the body: the
        // chat is unresolvable here (the derived id is the chat with oneself).
        removeMessageFromInbox(
          msgId,
          `Incoming WebRTC chat message ${msgId} from own device names no known chat. Removing it from inbox.`,
          HANDLED_ELSEWHERE_RETENTION_MILLIS,
        ).catch(err => w3n.log('error', `Failed to remove own unresolvable WebRTC message`, err));
        return;
      }
      removeMessageFromInbox(
        msgId,
        `Incoming WebRTC chat message ${msgId}, type has no known chat. Removing it from inbox.`,
      ).catch(err => w3n.log('error', `Failed to remove chatless WebRTC message`, err));
      return;
    }

    if (chat.isGroupChat && !includesAddress(Object.keys(chat.members), sender)) {
      removeMessageFromInbox(
        msgId,
        `Sender ${sender} is not a member of group chat ${chat.chatId}. Removing it from inbox.`,
      ).catch(err => w3n.log('error', `Failed to remove non-member WebRTC message`, err));
      return;
    }

    const now = Date.now();
    // Two independent age measurements (see SignalAge in call-state.ts): the
    // sender's own stamp catches a message that sat in the shared inbox, the
    // local delivery stamp catches a sender whose clock runs ahead - either
    // alone let an old 'start' ring for a call that was long over. The rules
    // for an absent or impossible stamp live in signalAgeOf(), which is pure
    // and covered by spec.
    const msgAge: SignalAge = signalAgeOf(webrtcMsg, msg.deliveryTS, now);
    const sessionId = webrtcMsg.callSessionId;

    try {
      // Handle heartbeat messages for re-join feature
      if (webrtcMsg.stage === 'heartbeat') {
        const hbData = Array.isArray(webrtcMsg.data) ? webrtcMsg.data[0] : webrtcMsg.data;

        // Handle requestStart: a peer received orphaned WebRTC signals
        // (ICE candidates, answers) without a preceding 'start' signal
        // (lost in ASMail delivery). The peer asks us (the host) to
        // re-send the 'start' signal so it can create a CallInChat and
        // show the incoming-call UI. Without this, the peer would buffer
        // the orphaned signals for 45s (PENDING_SIGNAL_TTL_MILLIS) and
        // then drop them — the user misses the call entirely. This is
        // especially critical for one-to-one calls, where no heartbeat
        // re-join mechanism exists.
        const request = readRequestStart(hbData, sender);
        if (request) {
          const { requester } = request;
          const call = calls.get(chatKey);
          // Whether the call is still one we may invite this peer into is a
          // question about state, not about time: re-sending 'start' for a call
          // that is over is exactly what re-opened the incoming-call UI after a
          // 1-1 call ended (the "second ringtone" bug).
          const verdict = sessions.admitsRequestStart(
            chatId,
            requester,
            request.callSessionId,
            addr => {
              if (!call?.hasPeer(addr)) {
                return 'unknown';
              }
              // Already exchanged SDP with us, so someone at that address is in
              // the call and needs no 'start'. See the 'connected' branch of
              // admitsRequestStart for what answering one anyway does.
              return call.getConnectedClients?.().some(c => areAddressesEqual(c.addr, addr))
                ? 'connected'
                : 'invited';
            },
            now,
          );
          if (verdict === 'accept') {
            log.debug(`[${ownAddr}] Re-sending 'start' to ${requester} (requestStart)`);
            const startMsg: WebRTCMsg = {
              stage: 'start',
              id: Date.now(),
              callSessionId: call?.getCallSessionId?.(),
              data: (typeof call?.getStartedAt?.() === 'number')
                ? { startedAt: call.getStartedAt!() }
                : {},
            };
            sendWebRTCMsg(chatId, requester, ownAddr, startMsg, {
              // Literally the same gate as the initial invitation, asked of the
              // call object rather than restated here: `hasPeer` was the wrong
              // question and made this gate always false, since a host's peer map
              // holds everyone it invited (see isInvitePending / call-state.ts).
              stillNeeded: () => {
                const liveCall = calls.get(chatKey);
                return !!liveCall?.isInvitePending?.(requester);
              },
            }).catch(err => {
              w3n.log('error', `Failed to re-send 'start' to ${requester} on requestStart`, err);
            });
          } else {
            logDroppedSignal(verdict, 'request-start', requester, chatId);
          }
          // Delayed, and fire-and-forget (as everywhere on this queue): the
          // request is addressed to the host, and which of that address's
          // devices is hosting the call is not something the asking peer knows.
          // Taking it out at once lets a device with no call answer it - which
          // is to say drop it - before the device that could actually re-send
          // the invitation ever sees it.
          removeMessageFromInbox(msgId, undefined, HEARTBEAT_RETENTION_MILLIS).catch(err => {
            w3n.log('error', `Failed to remove 'request-start' from inbox`, err);
          });
          return;
        }

        // A beat one of our own devices passed on to us, because the host's own
        // never reach this one (see `relayedRejoin` in asmail-msgs.types.ts).
        // Our own copy of what we relayed - delivery to one's own address comes
        // back to the sender - is recognized here by its device id and left
        // alone; it goes out of the inbox with every other beat below.
        const relayMark = hbData?.relayedRejoin;
        const isRelayedToUs = !!relayMark && fromOwnDevice
          && (relayMark.byDeviceId !== localDataStore.getAppDeviceId());

        // A heartbeat means "a call is going on in this chat, you may join".
        // Only group chats have anything to re-join: in 1-1 the call is over as
        // soon as either side leaves. The `calls` check is defence in depth
        // against a heartbeat arriving exactly as we are (re)joining: the state
        // rules cover that too, but a live call object must never be shadowed by
        // a "you may join" record.
        if (chat.isGroupChat && !calls.has(chatKey)
          && (isRelayedToUs || !areAddressesEqual(sender, ownAddr))
        ) {
          // Extract host address from heartbeat payload (for re-join as CLIENT).
          // Fall back to the heartbeat sender for older peers that don't send it.
          const callHostAddr = hbData?.hostAddr || sender;
          // For a relayed beat the envelope names the device that passed it on,
          // not the host, and the rules that compare a beat's sender against the
          // host of a finished call (admitsHeartbeat) have to see the host.
          const beatFrom = isRelayedToUs ? callHostAddr : sender;
          const verdict = sessions.admitsHeartbeat(chatId, beatFrom, sessionId, msgAge, now);
          if (verdict === 'accept') {
            if (sessions.noteHeartbeat(chatId, callHostAddr, sessionId, now)) {
              log.info(
                `[${ownAddr}] Call in chat ${chatId.chatId} may be joined, `
                  + `hosted by ${callHostAddr}`
                  + (isRelayedToUs ? ` (heartbeat relayed by own device ${relayMark!.byDeviceId})` : ''),
              );
              sinkGUIEvents({
                type: 'call-active',
                chatId,
                isCallActive: true,
              });
            }
            relayBeatToOwnDevices(chatId, chatKey, callHostAddr, sessionId, !!relayMark, now);
          } else {
            logDroppedSignal(verdict, isRelayedToUs ? 'relayed heartbeat' : 'heartbeat', beatFrom, chatId);
          }
        }

        // A live call in this chat and we are its client: the heartbeat is
        // the host's "still here", feeding the call window's host-silence
        // watchdog — the one signal small enough to keep arriving when
        // SDP-sized deliveries are failing. The session must match (absent
        // ids, from older peers, pass): a heartbeat of an earlier call must
        // not keep the current window alive.
        const liveCall = calls.get(chatKey);
        if (
          liveCall && chat.isGroupChat && !areAddressesEqual(sender, ownAddr)
          && (liveCall.getRole?.() === 'client')
        ) {
          const liveSessionId = liveCall.getCallSessionId?.();
          if (!sessionId || !liveSessionId || (sessionId === liveSessionId)) {
            await forwardSignalToCall(liveCall, chatId, sender, webrtcMsg, msgId);
            return;
          }
          logDroppedSignal('drop-foreign-session', 'heartbeat', sender, chatId);
        }

        // Out of the inbox, but on a delay: a heartbeat is addressed to the user
        // and every device of that address has its own use for it (see
        // HEARTBEAT_RETENTION_MILLIS). Whichever of them reads it first must not
        // take it from the rest - least of all from the one whose "Join Call"
        // button has no other source. Fire-and-forget, as everywhere on this
        // queue (see the note in forwardSignalToCall).
        removeMessageFromInbox(msgId, undefined, HEARTBEAT_RETENTION_MILLIS).catch(err => {
          w3n.log('error', `Failed to remove heartbeat from inbox`, err);
        });
        return;
      }

      const call = calls.get(chatKey);

      // Handle a 'disconnect' signal that arrives when we have no active
      // CallInChat for this chat (e.g. we already left the group call
      // earlier). If the sender is the host of the call we were tracking for
      // re-join, that call has ended for everyone — drop the record right away
      // instead of waiting for its heartbeats to time out, so the "Join" button
      // disappears immediately.
      if (!call && webrtcMsg.stage === 'disconnect' && !areAddressesEqual(sender, ownAddr)) {
        const record = sessions.get(chatId);
        if (record?.callSessionId && sessionId && (record.callSessionId !== sessionId)) {
          // A straggler of an earlier call. Acting on it would mark the call we
          // are currently tracking as ended and take the "Join Call" button away
          // from a call that is still going.
          logDroppedSignal('drop-foreign-session', `'disconnect'`, sender, chatId);
          removeMessageFromInbox(msgId).catch(err => {
            w3n.log('error', `Failed to remove stale 'disconnect' from inbox`, err);
          });
          return;
        }
        if (chat.isGroupChat) {
          const wasRejoinable = record?.state === 'rejoinable';
          const fromTrackedHost = !!record?.hostAddr && areAddressesEqual(record.hostAddr, sender);
          // Marked ended by the host even when we had no record: a heartbeat of
          // that call may still be in flight and would otherwise switch the
          // "Join Call" button on for a call that is already over. Self-limiting:
          // suppression only covers heartbeats of this very session (or, for
          // peers without session ids, from this very sender), so a stray
          // 'disconnect' from a non-host peer cannot hide a live call.
          // noteRemoteEnded, not transit: with no record at all the chat is
          // `idle`, and 'ended' is not an entry state — transit() refused it,
          // logged "Ignoring call state transition idle -> ended" and left the
          // chat with no tombstone, so the very stragglers this branch exists
          // to suppress went on to resurrect the "Join Call" button.
          sessions.noteRemoteEnded(chatId, now, {
            hostAddr: sender,
            callSessionId: sessionId,
          });
          if (!record) {
            log.info(
              `Recording host-ended session for chat ${chatIdToString(chatId)} from a late `
              + `'disconnect' by ${sender} (chat was idle)`,
            );
          }
          if (wasRejoinable && fromTrackedHost) {
            sinkGUIEvents({
              type: 'call-active',
              chatId,
              isCallActive: false,
            });
          }
        }
        // Nothing else to do — consume the message. Do not buffer it into
        // pendingSignals, as there is no CallInChat to eventually drain it
        // into, and a stale disconnect could otherwise corrupt a future
        // re-join's freshly created CallInChat. This applies to one-to-one
        // chats too: a 'disconnect' with no active call means the call was
        // already ended/never joined, so there is nothing to react to.
        removeMessageFromInbox(msgId).catch(err => {
          w3n.log('error', `Failed to remove no-call 'disconnect' from inbox`, err);
        });
        return;
      }

      if (webrtcMsg.stage === 'start') {
        // Whether this 'start' may open a call is decided in one place: it is
        // the same question as "is a call of another session already on here",
        // "did the call of this session already end", and "is this 'start' so
        // old that it cannot be a live call" (e.g. delivered late after the app
        // was offline — without this, opening the app would pop up an incoming
        // call for a call that is long over).
        const verdict = sessions.admitsStart(
          chatId, sessionId, msgAge, now, { hostAddr: sender, startedAt: startedAtOf(webrtcMsg) },
        );
        if (verdict === 'accept-superseding') {
          // Two hosts invited us at the same moment, and the call ringing here is
          // the one both of them are going to give up. Ring for this one instead:
          // its host's withdrawal of the other may take a while yet, and nothing
          // would repeat this 'start' in time to be heard.
          log.info(
            `[${ownAddr}] Call of ${sender} (session ${sessionId ?? 'n/a'}) supersedes the one `
              + `ringing in chat ${chatId.chatId}; ringing for it instead`,
          );
          if (call) {
            await call.end({ silent: true });
          }
          sinkGUIEvents({ type: 'call-ended', chatId });
          await handleIncomingCall(chat, chatId, sender, webrtcMsg, msgId);
          return;
        }
        // We host a call of our own in this chat, and someone else has just
        // started another one: the two must become one (see resolveCallCollision).
        // Also when ours is already under way ('drop-in-call'): ours then stays,
        // but the rival host has to be told so - nothing else would make it give
        // way. Not when the sender is already in our call: that is a leftover
        // copy of the 'start' of a call it has since given up for ours.
        const ownState = sessions.state(chatId);
        const isRivalCall = !!call && (call.getRole?.() === 'host')
          && !!ownState && isSignallingState(ownState)
          && !areAddressesEqual(sender, ownAddr)
          && !!sessionId && (sessionId !== call.getCallSessionId?.())
          && !call.getConnectedClients?.().some(c => areAddressesEqual(c.addr, sender));
        if (isRivalCall && ((verdict === 'accept') || (verdict === 'drop-in-call'))) {
          await resolveCallCollision(chat, chatId, call!, {
            hostAddr: sender,
            callSessionId: sessionId,
            startedAt: startedAtOf(webrtcMsg),
            established: false,
          }, msgId);
          return;
        }
        if (verdict !== 'accept') {
          await dropSignal(
            verdict,
            `'start' (age: sender ${msgAge.fromSenderClock}ms, delivery ${msgAge.sinceDelivery}ms)`,
            sender, chatId, msgId, now,
            { important: true, stage: 'start' },
          );
          return;
        }
        if (call) {
          // A re-sent 'start' of the call we are already in: the call object is
          // idempotent about it.
          await forwardSignalToCall(call, chatId, sender, webrtcMsg, msgId);
          return;
        }
        await handleIncomingCall(chat, chatId, sender, webrtcMsg, msgId);
        return;
      }

      // Taken before admitsSignal: the notice names the sender's own call, which
      // by definition is a session other than the one going on here.
      if (firstBodyItem?.callCollision && !fromOwnDevice) {
        return await handleCallCollisionNotice(
          chat, chatId, sender, webrtcMsg, firstBodyItem.callCollision, msgId,
        );
      }

      const verdict = sessions.admitsSignal(chatId, sessionId, msgAge, now);
      if (verdict !== 'accept') {
        await dropSignal(
          verdict,
          `'${webrtcMsg.stage}' (age: sender ${msgAge.fromSenderClock}ms, delivery ${msgAge.sinceDelivery}ms)`,
          sender, chatId, msgId, now,
          { important: (webrtcMsg.stage === 'disconnect'), stage: webrtcMsg.stage },
        );
        return;
      }

      // The host ended a call that is still ringing here. The call object would
      // decline this signal (its callStage is 'not-started' until the user
      // answers), leaving the ringtone playing, so it is handled outside of it.
      if (call && (webrtcMsg.stage === 'disconnect')
        && isHostEndingRingingCall(sessions.get(chatId), sender, sessionId)) {
        await handleHostEndedRingingCall(chatId, sender, sessionId, call, msgId);
        // The host withdrew its call for another one started at the same
        // moment: ring for that one. Its own 'start' may have been refused while
        // this one rang, and the next copy of it can be half a minute away.
        const by = firstBodyItem?.supersededBy;
        if (by && !calls.has(chatKey) && !isStaleAge(msgAge)
          && (!chat.isGroupChat || includesAddress(Object.keys(chat.members), by.hostAddr))
          && !areAddressesEqual(by.hostAddr, ownAddr)) {
          log.info(
            `[${ownAddr}] Call of ${sender} in chat ${chatId.chatId} was withdrawn in favour `
              + `of the call of ${by.hostAddr}; ringing for that one`,
          );
          await handleIncomingCall(chat, chatId, by.hostAddr, {
            stage: 'start',
            id: Date.now(),
            callSessionId: by.callSessionId,
            data: (typeof by.startedAt === 'number') ? { startedAt: by.startedAt } : {},
          }, undefined);
        }
        return;
      }

      if (call) {
        await forwardSignalToCall(call, chatId, sender, webrtcMsg, msgId);
      } else {
        // A teardown signal with no call to apply it to is spent, not early.
        // Star signals ride `stage: 'signalling'`, so a client's farewell
        // 'disconnect' used to land here: buffered as if a call were about to
        // open, and — worse — answered with a 'request-start' asking the
        // departing client to re-send a 'start' it never sent (the branch below
        // assumed the sender must be the host).
        const starType = starSignalTypeOf(webrtcMsg);
        const isTeardownLike = ((starType !== null)
            && TEARDOWN_STAR_SIGNALS.has(starType))
          || !!firstBodyItem?.callDeclined
          || !!firstBodyItem?.callFull
          || !!firstBodyItem?.callHandledElsewhere;
        if (isTeardownLike) {
          log.info(
            `Dropping orphan teardown-like '${starType ?? webrtcMsg.stage}' from ${sender} `
            + `in chat ${chatId.chatId}: no call to apply it to`,
          );
          removeMessageFromInbox(msgId).catch(err => {
            w3n.log('error', `Failed to remove orphan teardown signal from inbox`, err);
          });
          return;
        }

        // Buffer non-start signals that arrive before CallInChat is created.
        // This handles the race where ICE candidates or answers arrive
        // before the start message due to network timing.
        let pending = pendingSignals.get(chatKey);
        if (!pending) {
          pending = [];
          pendingSignals.set(chatKey, pending);
          // Request the host to re-send the 'start' signal.
          // Without this, orphaned signals (e.g. ICE candidates from a call
          // whose 'start' was lost in transit) accumulate for 45 seconds
          // and are dropped — the user misses the call entirely.
          // Sending a lightweight request-for-start may trigger the host
          // to re-heartbeat (which includes the hostAddr for re-join).
          //
          // Only to a plausible host: with a record in hand, asking anyone but
          // its host to produce a 'start' is asking a fellow client for
          // something it cannot send.
          const record = sessions.get(chatId);
          const senderMayBeHost = !record
            || !record.hostAddr
            || areAddressesEqual(record.hostAddr, sender);
          // A call hosted by another device of ours: the inbox belongs to the
          // address, so this device picks up the peer's signalling for a call it
          // is not in, and there is nothing to ask for - a host does not send
          // 'start' to its own address. Seen in the live run of 2026-08-16,
          // where an idle device asked the peer, mid-call, to re-send a 'start'
          // that the peer never sent. The session id names its host, and that is
          // the only part of it anything may read.
          const sessionHost = hostAddrOfCallSession(sessionId);
          const hostedByUs = !!sessionHost && areAddressesEqual(sessionHost, ownAddr);
          if (hostedByUs) {
            log.debug(
              `Not asking ${sender} to re-send 'start' for chat ${chatId.chatId}: `
              + `session ${sessionId} is hosted by this user (another device of ours)`,
            );
          } else if (senderMayBeHost) {
            requestStartRetransmission(chatId, sender, sessionId);
          } else {
            log.debug(
              `Not asking ${sender} to re-send 'start' for chat ${chatId.chatId}: `
              + `not the tracked host (${record.hostAddr})`,
            );
          }
        }
        pending.push({ sender, webrtcMsg, msgId, bufferedAt: now });
      }
    } catch (err) {
      await w3n.log('error', `Error is thrown while handling WebRTC chat message`, err);
      // MUST NOT be awaited: the delayed removal sleeps MSG_REMOVAL_DELAY_MILLIS
      // first, and this handler runs inside the single WebRTC message queue —
      // awaiting here used to stall every queued signal of every peer for 10s
      // whenever one message failed to process.
      removeMessageFromInbox(msgId, undefined, MSG_REMOVAL_DELAY_MILLIS).catch(rmErr => {
        w3n.log('error', `Failed to remove failed WebRTC message from inbox`, rmErr);
      });
    }
  }

  /**
   * Tells the host that this device is re-joining, and says it twice more.
   *
   * The notice is ~250 B and rides `stage: 'signalling'`, which is
   * fire-and-forget with neither confirmation nor a resend of its own - and in
   * the group call of 2026-08-13 19:36 that cost the whole feature: the notice
   * went out at the right moment (79s before the offer reached the host) and
   * died on a single 500 from `/asmail/delivery/msg/obj`. Three copies of a
   * 250 B message are a rounding error next to the 21 KB offer they run ahead
   * of, and they buy the one thing the notice exists for.
   *
   * Each copy is stamped afresh, so the host's arrival gate takes it as a new
   * notice rather than a duplicate - and the host re-announces on it while the
   * peer is still absent. That is what makes the notice self-healing: a late
   * 'participant-left' (an ASMail copy of the earlier departure, which can
   * arrive after the return was announced) takes the placeholder tile down,
   * and the next copy puts it back.
   */
  function sendRejoinNotice(
    chatId: ChatIdObj, hostAddr: string, callSessionId: string | undefined,
  ): void {
    const chatKey = chatIdToString(chatId);
    const sendOne = () => {
      sendWebRTCMsg(
        chatId, hostAddr, ownAddr, rejoinNoticeMsg(callSessionId, ownAddr, Date.now()),
      ).catch(err => {
        w3n.log('error', `Failed to send re-join notice to host ${hostAddr}`, err);
      });
    };
    sendOne();
    for (const delay of REJOIN_NOTICE_REPEAT_DELAYS_MILLIS) {
      setTimeout(() => {
        try {
          // The window was closed again, or the call ended: there is no return to
          // announce any more, and a notice after the fact would only put a
          // "connecting…" up for someone who is not coming.
          if (!calls.has(chatKey)) {
            return;
          }
          sendOne();
        } catch (err) {
          log.error('sendRejoinNotice timeout error:', err);
        }
      }, delay);
    }
  }

  async function startVideoCallForChatRoom(chatId: ChatIdObj): Promise<void> {
    let call = calls.get(chatIdToString(chatId));
    let direction: 'incoming' | 'outgoing' = 'outgoing';
    let callHostAddr: string | undefined = undefined;
    if (!call) {
      const chat = chatSrv.findChatEntry(chatId, true)!;
      // A chat marked re-joinable has a call going on in it, hosted by someone
      // whose heartbeats we have been seeing.
      const rejoinable = sessions.get(chatId);
      const isRejoiningActiveCall = rejoinable?.state === 'rejoinable';
      const rejoinTarget = rejoinTargetOf(rejoinable, ownAddr);

      if (isRejoiningActiveCall && !rejoinTarget) {
        // The button is up, but the record cannot say whose call it is about
        // (see rejoinTargetOf). Starting a call of our own instead is what the
        // run of 2026-08-17 did, and it is strictly worse than doing nothing:
        // the live call's participants refuse the invitation, their host's
        // 'disconnect' is later read as a foreign session, and the chat records
        // an outgoing call nobody attended. So the button goes away instead -
        // it was promising something this device cannot deliver. The window is
        // never opened: that happens in call.startCall(), below.
        log.warn(
          `[${ownAddr}] Refusing to re-join the call in ${chatId.chatId}: the record names `
            + `no host to join (session ${rejoinable?.callSessionId ?? 'unknown'}); `
            + `taking the "Join Call" button down`,
        );
        sessions.drop(chatId);
        sinkGUIEvents({ type: 'call-active', chatId, isCallActive: false });
        return;
      }

      if (rejoinTarget) {
        // Re-joining a call that is hosted by someone else — we must join
        // as CLIENT, not start a new call as HOST. Otherwise the GUI shows
        // "Start Call" instead of "Join" and the star topology breaks.
        // The session id comes from that host's heartbeats, so our signals
        // carry the id of the call we are joining, not a new one.
        direction = 'incoming';
        callHostAddr = rejoinTarget.hostAddr;
        log.info(`[${ownAddr}] Re-joining active call in ${chatId.chatId} as CLIENT (host: ${callHostAddr})`);
        // Tell the host we are coming back BEFORE anything else happens, so it
        // can put a "connecting…" tile up at the other participants. Until this
        // existed, the first thing anyone learned of a return was the SDP offer
        // - 13-21 KB against this message's ~250 B, and 50s of silence in the
        // group call of 2026-08-13. Deliberately not awaited: startCall() must
        // not wait on an ASMail round trip.
        sendRejoinNotice(chatId, callHostAddr, rejoinTarget.callSessionId);
        // And the user's other devices are told that this call is taken, exactly
        // as answering a ringing one tells them (joinOrDismissCallInRoom). They
        // are holding a "Join Call" button for the very call this device is
        // entering, and taking that offer would put two devices of one address
        // into it - which the host, keying peers by address, cannot tell apart.
        // Until this, the button on the neighbour stood until its record ran out
        // (run of 2026-08-17: it did eventually go, but on a timeout, with the
        // window wide open in between).
        sendCallHandledElsewhere(
          chatId, ownAddr, localDataStore.getAppDeviceId(), true, rejoinTarget.callSessionId,
        ).catch(err => {
          w3n.log('error', `Failed to tell own devices that this call is being re-joined here`, err);
        });
        call = await createAndRegisterCall(chat, chatId, {
          initialState: 'connecting',
          isRejoiningActiveCall: true,
          direction: 'incoming',
          hostAddr: callHostAddr,
          callSessionId: rejoinTarget.callSessionId,
        });
        // Pre-set role as CLIENT before startCall() so it doesn't
        // re-initialize as HOST.
        call.initializeRole('incoming', callHostAddr);
      } else {
        // A chat with no live call of anyone else's: this is a call of our own.
        // direction='outgoing', hostAddr=ownAddr, and we mint the session id
        // every participant will echo back. Nothing re-joinable reaches here -
        // a record in that state either produced a target above or took the
        // button down.
        call = await createAndRegisterCall(chat, chatId, {
          initialState: 'dialing',
          direction: 'outgoing',
          hostAddr: ownAddr,
          callSessionId: await localDataStore.nextCallSessionId(ownAddr),
        });
      }
    }
    await call.startCall();

    const { doAfterStartCall } = postProcessingForVideoChat();
    await doAfterStartCall({
      chatId, direction, sender: callHostAddr,
      callSessionId: call.getCallSessionId?.(),
    });
  }

  async function endVideoCallInChatRoom(chatId: ChatIdObj): Promise<void> {
    const call = calls.get(chatIdToString(chatId));
    if (!call) {
      // The button was armed by a call this device no longer has. Returning
      // silently left it armed until the next push event - and when the click
      // happens precisely because no event is coming, that is never (the End
      // Call button that survived the whole incident of 2026-09-10). So: put
      // the session record to rest if it is still standing, and tell the GUI
      // what the ordinary end of a call would have told it.
      log.info(
        `[${ownAddr}] End of call asked for chat ${chatId.chatId} with no call object here`,
      );
      const record = sessions.get(chatId);
      if (record && (record.state !== 'ended')) {
        sessions.transit(chatId, 'ended', Date.now(), { endedBy: 'self' });
      }
      sinkGUIEvents({
        type: 'call-ended',
        chatId,
      });
      return;
    }
    await call.endCallInGUI();
  }

  /**
   * All incoming calls go throw this controller first, creating call objects
   * that open other UI elements. Those other elements send tell to either join
   * or ignore call.
   * @param chatId
   * @param join tells to either join call (true value), or dismiss it (false)
   * @param sender who was the current call's initiator
   * @returns the session id of the call that was acted upon, for the caller to
   * name in its system message about the cancelled call.
   */
  async function joinOrDismissCallInRoom(
    chatId: ChatIdObj, join: boolean, sender?: string, expectedCallSessionId?: string,
  ): Promise<{ handled: boolean; callSessionId?: string }> {
    const call = calls.get(chatIdToString(chatId));
    const callSessionId = call?.getCallSessionId?.();
    // At `info`: this is the user's own answer to the call, and the one event
    // that tells apart "this device never rang" from "this device rang and was
    // answered/declined here".
    log.info(
      `[${ownAddr}] Call in chat ${chatId.chatId} ${join ? 'joined' : 'declined'} on this `
        + `device (${localDataStore.getAppDeviceId()}); host: ${sender ?? 'unknown'}, `
        + `session: ${callSessionId ?? 'n/a'}`,
    );
    if (!call) {
      return { handled: false };
    }
    if (expectedCallSessionId && callSessionId
      && (expectedCallSessionId !== callSessionId)) {
      // The button the user clicked was armed for a session that is over; a
      // different call is going on in this chat now. Acting on the click would
      // answer/decline the live call the user never saw ringing.
      log.info(
        `[${ownAddr}] Ignoring ${join ? 'join' : 'dismiss'} of call in chat ${chatId.chatId}: `
          + `the click was about session ${expectedCallSessionId}, but session `
          + `${callSessionId} is going on`,
      );
      return { handled: false };
    }

    // Every device of ours is ringing for this call, and nothing in the call
    // protocol would ever tell them it has been dealt with: the host hears only
    // from the device that joined. Sent before the work below, so the other
    // devices go quiet while this one is still setting up its media.
    sendCallHandledElsewhere(chatId, ownAddr, localDataStore.getAppDeviceId(), join, callSessionId)
      .catch(err => {
        w3n.log('error', `Failed to tell own devices that the call was handled here`, err);
      });

    if (join) {
      // The same notice a returning participant sends, for the same reason: the
      // host otherwise learns of the answer only from our SDP offer, which goes
      // out after the window has opened and the camera has started, and is the
      // slowest message on the ASMail path. Until it lands, the caller sits on
      // "waiting for participants" with the ringtone still playing. A host on an
      // older build ignores the notice and waits for the offer, as before.
      if (sender) {
        sendRejoinNotice(chatId, sender, callSessionId);
      }
      // Pre-set role as CLIENT before startCall() so it doesn't re-initialize as HOST.
      // sender is the host's mailerId (the call initiator).
      call.initializeRole('incoming', sender);
      await call.startCall();
      const { doAfterStartCall } = postProcessingForVideoChat();
      await doAfterStartCall({ chatId, direction: 'incoming', sender, callSessionId });
    } else {
      // Tell the host this was an explicit decline (as opposed to merely
      // being unreachable), so its connecting banner doesn't wait out the
      // no-answer timeout. sender is the host's address; skip silently if
      // it wasn't provided rather than guessing at who the host is.
      if (sender) {
        sendCallDeclined(chatId, sender, ownAddr, callSessionId).catch(err => {
          w3n.log('error', `Failed to send call-declined to host ${sender}`, err);
        });
      }
      // Silent, and said outright rather than left to the fact that no role was
      // initialized on this path: a declining device must never send
      // 'disconnect'. Peers are keyed by address, so the host would read it as
      // coming from whichever device of ours actually joined - in a one-to-one
      // chat that tears down the live call. 'call-declined' above is the signal
      // that says "not here", and it carries the address-level caveat with it.
      await call.end({ silent: true });
    }
    return { handled: true, callSessionId };
  }

  function watchVideoChats(obs: web3n.Observer<VideoChatEvent>): () => void {
    videoChatsObs.add(obs);
    return () => videoChatsObs.delete(obs);
  }

  /**
   * The declining side's 'incoming-call-cancelled' system message, acted upon
   * here as well as in the GUI.
   *
   * It is the second, independent way a decline reaches the caller: the
   * 'call-declined' signal is sent out-of-queue and is normally the faster of the
   * two, but it is a single message whose loss has no other recovery, whereas
   * this one travels the ordinary delivery queue. Acting on it here rather than
   * only in the chat window is what makes it work regardless of whether a window
   * is open - which is exactly the case a lost signal leaves behind.
   *
   * 'outgoing-call-cancelled' is the same kind of second route for the host's
   * hangup: the 'disconnect' signal is normally faster, but it can be lost
   * (never-opened DataChannel plus a degraded ASMail delivery), and a client
   * who misses it sits in a dead call window until the host-silence watchdog
   * (90s+). The system message travels the ordinary delivery queue, so acting
   * on it here tears the client's call down within seconds instead.
   *
   * Gated on the call this cancellation names, because this message is nothing
   * like the signal in how long it stays around: it sits in the inbox for days
   * and the start-up catch-up scan replays it. See admitsCallCancelSysMsg.
   */
  const stopCallSysMsgWatching = chatSrv.onIncomingCallSysMsg(params => {
    const { chatId, sender, subType, callSessionId, deliveryTS } = params;
    if (subType === 'call-collision-failed') {
      // The other host's report that our two calls never met. The record is
      // written whenever the message is seen - its id makes a replay at
      // start-up a no-op - but the notice only while it is news.
      recordFailedCallCollision(chatId, sender, callSessionId).catch(err => {
        w3n.log('error', `Failed to record the failed call collision in chat ${chatId.chatId}`, err);
      });
      if ((Date.now() - deliveryTS) <= MAX_SIGNAL_AGE_MILLIS) {
        sinkGUIEvents({
          type: 'call-collision',
          chatId,
          peerAddr: sender,
          collisionOutcome: 'unresolved',
        });
      }
      return;
    }
    if ((subType !== 'incoming-call-cancelled') && (subType !== 'outgoing-call-cancelled')) {
      return;
    }
    const call = calls.get(chatIdToString(chatId));
    if (!call) {
      return;
    }
    if (subType === 'outgoing-call-cancelled') {
      // Only a client acts on the host's withdrawal, and only when the message
      // really comes from this call's host: any other sender must not be able
      // to end someone's call with a crafted system message.
      const host = call.getHostAddr?.();
      if (!call.noteHostEndedCall || (call.getRole?.() !== 'client')
        || !host || !areAddressesEqual(host, sender)) {
        return;
      }
    } else if (!call.notePeerDeclined) {
      return;
    }
    const verdict = admitsCallCancelSysMsg({
      msgSessionId: callSessionId,
      callSessionId: call.getCallSessionId?.(),
      msgAge: Date.now() - deliveryTS,
    });
    if (verdict !== 'accept') {
      logDroppedSignal(
        verdict, `'${subType}' system message (session: ${callSessionId ?? 'n/a'})`,
        sender, chatId, true,
      );
      return;
    }
    log.info(
      `[${ownAddr}] '${subType}' system message from ${sender} for chat ${chatId.chatId} `
        + `(session ${callSessionId})`,
    );
    if (subType === 'outgoing-call-cancelled') {
      call.noteHostEndedCall!();
    } else {
      call.notePeerDeclined!(sender, callSessionId);
    }
  });

  /**
   * Whether any call is going on (or ringing) right now, in any chat. This is
   * what lets background maintenance that competes with signalling for ASMail
   * delivery (the resync pass, see msg-resync.ts) stay out of a call's way.
   */
  function hasAnyCallInProgress(): boolean {
    return sessions.all().some(({ state }) => isLiveState(state));
  }

  /**
   * Whether any call is sending signalling of its own right now.
   *
   * Narrower than hasAnyCallInProgress() by the `ringing` state, and used only by
   * traffic that yields to signalling and can wait indefinitely without being
   * lost - the journal of sync phantoms. A ringing call puts nothing of ours on
   * the wire, so making a phantom wait out an unanswered ring (up to 90 s) delays
   * the user's other devices for nothing. Resync and the reconcile sweep stay on
   * the broad check: they generate heavier traffic and have no urgency at all.
   */
  function hasAnyCallSignalling(): boolean {
    return sessions.all().some(({ state }) => isSignallingState(state));
  }

  /**
   * What this component currently believes about every chat's call.
   *
   * The push events ('call-started', 'call-ended', 'call-active') stay the way
   * call state reaches the GUI; this is how a window catches up with events it
   * never heard - one opened in the middle of a call, and, after 2026-09-10,
   * one whose background component stopped answering mid-call and left an End
   * Call button that nothing would ever clear.
   *
   * Everything but `ended`, rather than isLiveState(): the GUI needs
   * 'winding-down' (its End Call button is still up) and 'rejoinable' (it
   * offers "Join call"), neither of which counts as live here.
   */
  function getCallsState(): Promise<CallStateForGui[]> {
    return Promise.resolve(sessions.all()
      .filter(({ state }) => (state !== 'ended'))
      .map(({ chatId, state, since, hostAddr, callSessionId, role }) => ({
        chatId,
        state: state as CallStateForGui['state'],
        since,
        hostAddr,
        callSessionId,
        role,
        // From `calls`, not from the record: the record says a call exists,
        // this says we are the ones in it.
        inCallHere: calls.has(chatIdToString(chatId)),
      })));
  }

  const methods: VideoChatSrv = {
    handleIncomingWebRTCMsg,
    startVideoCallForChatRoom,
    endVideoCallInChatRoom,
    getCallsState,
    joinOrDismissCallInRoom,
    watchVideoChats,
    hasAnyCallInProgress,
    hasAnyCallSignalling,
  };

  // IPC exposure is NOT done here: it must happen at the very start of the
  // component (see index.ts), long before this service can be constructed.

  // Combined stop function that cleans up timers
  function stopVideoChatSrvWithCleanup(): void {
    clearInterval(heartbeatCleanupTimer);
    clearTimeout(startupPurgeTimer);
    stopCallSysMsgWatching();
  }

  return {
    videoChatSrv: methods,
    stopVideoChatSrv: stopVideoChatSrvWithCleanup,
  };
}
