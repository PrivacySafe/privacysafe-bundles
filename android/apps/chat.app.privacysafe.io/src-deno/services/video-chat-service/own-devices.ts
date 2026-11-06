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
import type { ChatIdObj, WebRTCMsg, WebRTCOffBandMessage } from '../../../types/asmail-msgs.types.ts';
import { chatIdToString, hostAddrOfCallSession } from '../../../shared-libs/chat-ids.ts';
import { sendWebRTCSignal } from '../../../shared-libs/webrtc-signalling.ts';
import { removeMessageFromInbox } from '../../utils/inbox-utils.ts';
import {
  REJOIN_NOTICE_REPEAT_DELAYS_MILLIS,
  rejoinNoticeMsg,
  relayRejoinHeartbeat,
  sendCallHandledElsewhere,
  sendWebRTCMsg,
} from './utils/_common.ts';
import { callHandledElsewhereOutcome, shouldRelayRejoinBeat } from './utils/call-state.ts';
import { HANDLED_ELSEWHERE_MAX_AGE_MILLIS, HANDLED_ELSEWHERE_RETENTION_MILLIS } from './constants.ts';
import { makeLogger } from '../../../shared-libs/logger.ts';
import type { VideoChatCtx } from './video-chat-ctx.ts';
import type { SignalInbox } from './signal-inbox.ts';

const log = makeLogger('VideoChatService');

/**
 * Coordination with the host and with this user's other devices that is not
 * part of the call itself: the request to re-send a lost 'start', a host's
 * heartbeat passed on to the devices it never reaches, the "call handled
 * elsewhere" notice, and the notice of a re-join.
 */
export function makeOwnDevices(ctx: VideoChatCtx, inbox: SignalInbox) {
  const {
    ownAddr, localDataStore, sessions, calls, answeredAsInCall, lastRejoinRelayAt, sinkGUIEvents,
  } = ctx;
  const { logDroppedSignal } = inbox;

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
          // A device of ours was in it: this one has been told of the call.
          heardOnly: false,
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

  return {
    readRequestStart,
    requestStartRetransmission,
    relayBeatToOwnDevices,
    handleCallHandledElsewhere,
    sendRejoinNotice,
  };
}

export type OwnDevices = ReturnType<typeof makeOwnDevices>;
