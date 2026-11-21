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
import type { ChatIdObj, ChatIncomingMessage, WebRTCMsg } from '../../../types/asmail-msgs.types.ts';
import type { CallInChat, ChatDbEntry } from '../../types/index.ts';
import { includesAddress, areAddressesEqual } from '../../../shared-libs/address-utils.ts';
import { chatIdToString, hostAddrOfCallSession } from '../../../shared-libs/chat-ids.ts';
import { starSignalTypeOf } from '../../../shared-libs/webrtc-signalling.ts';
import { removeMessageFromInbox } from '../../utils/inbox-utils.ts';
import { checkChatMessageJSONforWebRTC, sendWebRTCMsg, signalAgeOf } from './utils/_common.ts';
import type { SignalAge } from './utils/call-state.ts';
import { isHostEndingRingingCall, isSignallingState, isStaleAge } from './utils/call-state.ts';
import {
  HANDLED_ELSEWHERE_RETENTION_MILLIS,
  HEARTBEAT_RETENTION_MILLIS,
  MSG_REMOVAL_DELAY_MILLIS,
} from './constants.ts';
import { makeLogger } from '../../../shared-libs/logger.ts';
import type { VideoChatCtx } from './video-chat-ctx.ts';
import type { SignalInbox } from './signal-inbox.ts';
import type { OwnDevices } from './own-devices.ts';
import type { CallRegistry } from './call-registry.ts';
import { startedAtOf } from './call-registry.ts';
import type { CallCollisions } from './call-collisions.ts';

const log = makeLogger('VideoChatService');

/**
 * Star signal types that only make sense against a call that exists. Arriving
 * with no call, they are the residue of one that is over — never the early
 * signals of one about to start — so they are consumed rather than buffered,
 * and never answered with a 'request-start'.
 */
const TEARDOWN_STAR_SIGNALS: ReadonlySet<string> = new Set([
  'disconnect', 'dropped', 'participant-left', 'call-full',
]);

/**
 * An incoming WebRTC message that has passed the checks every signal goes
 * through in handleIncomingWebRTCMsg, with what those checks found out.
 */
interface IncomingSignal {
  chat: ChatDbEntry;
  chatId: ChatIdObj;
  chatKey: string;
  sender: string;
  msgId: string;
  webrtcMsg: WebRTCMsg;
  fromOwnDevice: boolean;
  now: number;
  msgAge: SignalAge;
  sessionId: string | undefined;
}

/**
 * The entry point of every incoming WebRTC message: the checks all of them go
 * through, and which part of the service each one is handed to.
 */
export function makeIncomingSignals(
  ctx: VideoChatCtx,
  inbox: SignalInbox,
  ownDevices: OwnDevices,
  registry: CallRegistry,
  collisions: CallCollisions,
) {
  const {
    ownAddr, chatSrv, blacklistTracker, localDataStore, sessions, calls, pendingSignals, sinkGUIEvents,
  } = ctx;
  const { logDroppedSignal, dropSignal, forwardSignalToCall } = inbox;
  const {
    readRequestStart, requestStartRetransmission, relayBeatToOwnDevices, handleCallHandledElsewhere,
  } = ownDevices;
  const { handleIncomingCall } = registry;
  const { resolveCallCollision, handleCallCollisionNotice } = collisions;

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

    const sig: IncomingSignal = {
      chat, chatId, chatKey, sender, msgId, webrtcMsg, fromOwnDevice, now, msgAge, sessionId,
    };

    try {
      // Handle heartbeat messages for re-join feature
      if (webrtcMsg.stage === 'heartbeat') {
        return await handleHeartbeat(sig);
      }

      const call = calls.get(chatKey);

      // Handle a 'disconnect' signal that arrives when we have no active
      // CallInChat for this chat (e.g. we already left the group call
      // earlier). If the sender is the host of the call we were tracking for
      // re-join, that call has ended for everyone — drop the record right away
      // instead of waiting for its heartbeats to time out, so the "Join" button
      // disappears immediately.
      if (!call && webrtcMsg.stage === 'disconnect' && !areAddressesEqual(sender, ownAddr)) {
        return await handleNoCallDisconnect(sig);
      }

      if (webrtcMsg.stage === 'start') {
        return await handleStart(sig, call);
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

  async function handleHeartbeat({
    chat, chatId, chatKey, sender, msgId, webrtcMsg, fromOwnDevice, now, msgAge, sessionId,
  }: IncomingSignal): Promise<void> {
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

  /** A 'disconnect' from a peer, with no call object of ours in this chat. */
  async function handleNoCallDisconnect({
    chat, chatId, sender, msgId, now, sessionId,
  }: IncomingSignal): Promise<void> {
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

  async function handleStart(
    { chat, chatId, sender, msgId, webrtcMsg, now, msgAge, sessionId }: IncomingSignal,
    call: CallInChat | undefined,
  ): Promise<void> {
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
    if (sessions.state(chatId) === 'rejoinable') {
      // Only a heard-only record lets a 'start' through (verdictAfterCall):
      // the invitation was overtaken by a heartbeat, and now that it rings,
      // the "Join call" the beat put up must go - the user answers the
      // ringing call instead, with Join/Decline.
      sinkGUIEvents({ type: 'call-active', chatId, isCallActive: false });
    }
    await handleIncomingCall(chat, chatId, sender, webrtcMsg, msgId);
    return;
  }

  return {
    handleIncomingWebRTCMsg,
  };
}
