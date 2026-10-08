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
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  ChatIdObj,
  ChatOutgoingMessage,
  ChatWebRTCMsgV1,
  WebRTCMsg,
  WebRTCMsgBodySysMsgData,
} from '../../../../types/asmail-msgs.types.ts';
import { chatIdToString, generateChatMessageId } from '../../../../shared-libs/chat-ids.ts';
import { registerHeartbeatDelivery } from './heartbeat-delivery.ts';
import { sendWebRTCSignal } from '../../../../shared-libs/webrtc-signalling.ts';
import { sendSystemDeletableMessage } from '../../mail-sending-service/index.ts';
import { withoutBlockedRecipients } from '../../../../shared-libs/blocked-recipients.ts';
import { MAX_CALL_PARTICIPANTS } from '../constants.ts';
import { makeLogger } from '../../../../shared-libs/logger.ts';

const log = makeLogger('VideoCallSignalling');

// Reading a signal out of an incoming body is pure and lives apart from this
// module, which sends signals and so pulls the mail-sending service in.
// Re-exported for the callers that only know this module.
export {
  checkChatMessageJSONforWebRTC, isRejoinNotice, REJOIN_NOTICE_REPEAT_DELAYS_MILLIS,
  rejoinNoticeMsg, signalAgeOf, startStageFirst,
} from './webrtc-msg-body.ts';
export type { WebRTCMsgInChat } from './webrtc-msg-body.ts';

export async function sendSystemMgsAboutDisconnectWebRTC({
  ownAddr,
  chatId,
  recipients,
  callSessionId,
}: {
  ownAddr: string;
  chatId: ChatIdObj;
  recipients: string[];
  /** Which call this cancellation is about; see WebRTCMsgBodySysMsgData. */
  callSessionId?: string;
}) {
  const chatSystemData: WebRTCMsgBodySysMsgData = {
    event: 'webrtc-call',
    value: {
      sender: ownAddr,
      subType: 'outgoing-call-cancelled',
      chatId,
      callSessionId,
    },
  };

  const { chatMessageId } = generateChatMessageId();
  return sendSystemDeletableMessage({
    chatId,
    recipients,
    chatMessageId,
    chatSystemData,
  });
}

/**
 * Tells the host of a call that ran into ours and never came in that the two
 * calls did not meet, so that its chat history says so too - its own call went
 * nowhere either, and from its side that looks like nobody answering.
 *
 * A system message rather than a signal: it is a record for the history, not a
 * step of a call, and the ordinary delivery queue gets it there even when the
 * rival's app is closed by now. A build that predates the subtype ignores it.
 */
export async function sendSystemMsgAboutFailedCallCollision({
  ownAddr,
  chatId,
  rivalHostAddr,
  callSessionId,
}: {
  ownAddr: string;
  chatId: ChatIdObj;
  rivalHostAddr: string;
  /** Our own call, the one that waited for the rival in vain. */
  callSessionId?: string;
}) {
  const chatSystemData: WebRTCMsgBodySysMsgData = {
    event: 'webrtc-call',
    value: {
      sender: ownAddr,
      subType: 'call-collision-failed',
      chatId,
      callSessionId,
    },
  };

  const { chatMessageId } = generateChatMessageId();
  return sendSystemDeletableMessage({
    chatId,
    recipients: [rivalHostAddr],
    chatMessageId,
    chatSystemData,
  });
}

/**
 * Sends a heartbeat message to all peers in a group chat.
 * This is a fire-and-forget message used for the re-join feature:
 * it lets other participants know that a call is still active.
 *
 * Uses `sendImmediately: true` so that heartbeats do not clog the ordered
 * delivery queue and do not delay critical WebRTC signalling messages.
 * Cleanup of completed deliveries is handled by delivery-monitor.ts via
 * the 'webrtc-call' localMeta.
 */
export async function sendHeartbeat(
  chatId: ChatIdObj,
  ownAddr: string,
  recipients: string[],
  hostAddr?: string,
  callSessionId?: string,
  /**
   * Whether this call is still on. Without it a reported delivery failure gets
   * no resend at all - a heartbeat accepted after the call ended re-lights the
   * recipient's "Join Call" button, so a resend must never outlive the call.
   */
  stillNeeded?: () => boolean,
): Promise<void> {
  // A blocked participant is told nothing about a call in progress, here as in
  // every other send; see shared-libs/blocked-recipients.ts. This call reaches
  // the platform directly rather than through the sending service, so it has
  // to ask for itself.
  const allowedRecipients = withoutBlockedRecipients(recipients);
  if (allowedRecipients.length === 0) {
    return;
  }

  const webrtcMsg: WebRTCMsg = {
    stage: 'heartbeat',
    // A real send stamp, like every other signal: the receiver measures the
    // beat's age against HEARTBEAT_MAX_AGE_MILLIS (call-state.ts), so the
    // former `id: 0` made every heartbeat look 56 years old and got EVERY one
    // of them dropped as 'drop-stale' — i.e. the whole re-join mechanism was
    // dead from the commit that added that age gate until this one.
    id: Date.now(),
    callSessionId,
    // Include host address so recipients can re-join as CLIENT to this host
    data: { hostAddr: hostAddr || ownAddr },
  };
  const jsonBody: ChatWebRTCMsgV1 = {
    v: 1,
    chatMessageType: 'webrtc-call',
    groupChatId: chatId.isGroupChat ? chatId.chatId : undefined,
    // Same body shape as asmailMsgFor() produces, see the comment there.
    chatId,
    webrtcMsg,
  };
  const msg: ChatOutgoingMessage = {
    msgType: 'chat',
    jsonBody,
  };

  const sentAt = Date.now();
  const deliveryId = `chat-heartbeat-${sentAt}-${Math.floor(10000 * Math.random())}`;

  // Registered BEFORE the send, and only when the caller can say whether the
  // call is still on: the monitor's event for this delivery may arrive as soon
  // as addMsg() resolves. See heartbeat-delivery.ts for why this is a resend and
  // not a confirmation.
  if (stillNeeded) {
    registerHeartbeatDelivery(deliveryId, {
      callKey: chatIdToString(chatId),
      sentAt,
      stillNeeded,
      resend: failedRecipients => sendHeartbeat(
        chatId, ownAddr, failedRecipients, hostAddr, callSessionId,
        // No `stillNeeded` on the resend itself: it is the resend, and letting
        // it register in turn would make the budget recursive.
      ),
    });
  }

  // Not routed through sendWebRTCSignal(): a heartbeat goes to *many*
  // recipients in one delivery, while a signal is always addressed to one peer.
  try {
    await w3n.mail!.delivery.addMsg(allowedRecipients, msg, deliveryId, {
      sendImmediately: true,
      localMeta: {
        chatId,
        chatMessageType: 'webrtc-call',
      },
    });
  } catch (err) {
    await w3n.log('error', `Fail to add heartbeat message to delivery`, err);
  }
  // NOTE: Delivery message cleanup is handled by delivery-monitor.ts
  // after progress.allDone. Manual rmMsg() here causes
  // "sending is not complete" errors due to race condition.
}

/**
 * Sends a WebRTC signalling message to a peer.
 *
 * Uses `sendImmediately: true` so signalling messages (offer/answer/candidate,
 * disconnect, start) bypass the ordered delivery queue — signalling is
 * latency-critical for ICE negotiation. Cleanup of completed deliveries is
 * handled by delivery-monitor.ts via the 'webrtc-call' localMeta.
 */
/**
 * Sends a call-full rejection signal to a client who tried to join a full call.
 * This is sent directly via ASMail so the client knows the call is at capacity
 * before the offer even reaches the GUI layer.
 */
export async function sendCallFullRejection(
  chatId: ChatIdObj,
  peerAddr: string,
  ownAddr: string,
  currentParticipants: number,
  callSessionId?: string,
): Promise<void> {
  const result = await sendWebRTCSignal({
    chatId,
    recipient: peerAddr,
    webrtcMsg: {
      stage: 'signalling',
      id: Date.now(),
      callSessionId,
      data: {
        callFull: {
          maxParticipants: MAX_CALL_PARTICIPANTS,
          currentParticipants,
        },
      },
    },
    deliveryIdPrefix: 'chat-call-full',
    logLabel: '[sendCallFullRejection]',
    signalName: 'call-full',
    confirm: true,
    blindRepeats: { delaysMillis: [BLIND_REPEAT_DELAY_MILLIS] },
  });

  if (result.ok) {
    log.debug(`[sendCallFullRejection] Sent call-full rejection to ${peerAddr} (${currentParticipants}/${MAX_CALL_PARTICIPANTS})`);
  } else {
    await w3n.log('error', `Fail to deliver call-full rejection to ${peerAddr}`, result.err);
  }
}

/**
 * Sends a "call declined" signal to the host when an invited participant
 * presses "Decline" on an incoming call. Lets the host's connecting banner
 * show "X declined the call" instead of waiting for the no-answer timeout.
 *
 * Uses the same idiom as sendCallFullRejection: a 'signalling'-stage message
 * with a custom payload field, rather than a new WebRTCMsg.stage value.
 *
 * Delivery is confirmed and retried, for the same reason as
 * 'call-handled-elsewhere': the declining device sends nothing else - it never
 * initialized a call role, so `end()` has no 'disconnect' to send - and this is
 * what tells the host that the call is over. A lost one leaves the host's window
 * waiting out its setup timeout, so it is worth the (unawaited) retries.
 */
export async function sendCallDeclined(
  chatId: ChatIdObj,
  hostAddr: string,
  ownAddr: string,
  callSessionId?: string,
): Promise<void> {
  const result = await sendWebRTCSignal({
    chatId,
    recipient: hostAddr,
    webrtcMsg: {
      stage: 'signalling',
      id: Date.now(),
      callSessionId,
      data: {
        callDeclined: {
          by: ownAddr,
        },
      },
    },
    deliveryIdPrefix: 'chat-call-declined',
    logLabel: '[sendCallDeclined]',
    signalName: 'call-declined',
    confirm: true,
    retries: { attempts: DELIVERY_RETRY_ATTEMPTS, delayMillis: DELIVERY_RETRY_DELAY_MILLIS },
    blindRepeats: { delaysMillis: [BLIND_REPEAT_DELAY_MILLIS] },
  });

  if (result.ok) {
    log.debug(`[sendCallDeclined] Sent call-declined to host ${hostAddr}`);
  } else {
    await w3n.log('error', `Fail to deliver call-declined to host ${hostAddr}`, result.err);
  }
}

/**
 * Tells the host of another call in this chat that we are calling too, with the
 * facts the tie-break needs (see callCollisionWinner in call-state.ts).
 *
 * The rival learns most of them from our own 'start' anyway; what it cannot
 * learn from there is `established` - that someone has answered our call since
 * - and without it the two hosts could settle on different winners. Confirmed
 * and retried like 'call-declined': a single message with no other recovery
 * path, and a lost one leaves both hosts waiting on each other.
 */
export async function sendCallCollision(
  chatId: ChatIdObj,
  rivalHostAddr: string,
  ownAddr: string,
  callSessionId: string | undefined,
  facts: { startedAt?: number; established: boolean },
): Promise<void> {
  const result = await sendWebRTCSignal({
    chatId,
    recipient: rivalHostAddr,
    webrtcMsg: {
      stage: 'signalling',
      id: Date.now(),
      callSessionId,
      data: {
        callCollision: {
          ...((typeof facts.startedAt === 'number') ? { startedAt: facts.startedAt } : {}),
          established: facts.established,
        },
      },
    },
    deliveryIdPrefix: 'chat-call-collision',
    logLabel: '[sendCallCollision]',
    signalName: 'call-collision',
    confirm: true,
    retries: { attempts: DELIVERY_RETRY_ATTEMPTS, delayMillis: DELIVERY_RETRY_DELAY_MILLIS },
    blindRepeats: { delaysMillis: [BLIND_REPEAT_DELAY_MILLIS] },
  });

  if (result.ok) {
    log.debug(`[sendCallCollision] Told ${rivalHostAddr} of our call in the same chat`);
  } else {
    await w3n.log('error', `Fail to tell ${rivalHostAddr} of our call in the same chat`, result.err);
  }
}

/**
 * Tells the user's other devices that this one has already answered or declined
 * the incoming call, so they stop ringing.
 *
 * An ASMail inbox belongs to the user, not to a device, so a call 'start' rings
 * on every device that is online. Nothing else in the protocol says "handled":
 * the host only ever hears from the device that joined, and it addresses peers
 * by address, so it cannot tell the others apart to begin with.
 *
 * Addressed to the user's own address - the same route sync phantoms take (see
 * sync-phantoms.ts). Delivery reaches this device too; the `deviceId` in the
 * body is how it recognizes and ignores its own copy. The chat is named in the
 * body (ChatWebRTCMsgV1.chatId), as there is no peer address in the envelope to
 * derive a one-to-one chat from.
 *
 * Delivery is confirmed and retried, unlike other 'signalling'-stage messages:
 * nothing else in the protocol tells the other devices that the call was dealt
 * with, so a lost notification has no recovery path - if the answering device
 * then ends the call, the others hear nothing at all and ring on. Costs no
 * latency here, as the caller does not await this.
 */
export async function sendCallHandledElsewhere(
  chatId: ChatIdObj,
  ownAddr: string,
  deviceId: string,
  joined: boolean,
  callSessionId?: string,
  inCall?: true,
  left?: true,
): Promise<void> {
  const result = await sendWebRTCSignal({
    chatId,
    recipient: ownAddr,
    webrtcMsg: {
      stage: 'signalling',
      id: Date.now(),
      callSessionId,
      data: {
        callHandledElsewhere: {
          deviceId, joined, ...(inCall ? { inCall } : {}), ...(left ? { left } : {}),
        },
      },
    },
    deliveryIdPrefix: 'chat-call-handled',
    logLabel: '[sendCallHandledElsewhere]',
    signalName: 'call-handled-elsewhere',
    confirm: true,
    retries: { attempts: DELIVERY_RETRY_ATTEMPTS, delayMillis: DELIVERY_RETRY_DELAY_MILLIS },
    blindRepeats: { delaysMillis: [BLIND_REPEAT_DELAY_MILLIS] },
  });

  if (result.ok) {
    log.debug(
      `[sendCallHandledElsewhere] Told own devices the call was `
        + `${left
          ? 'left here, and is theirs to join'
          : (inCall ? 'already going on' : (joined ? 'answered' : 'declined'))} here`,
    );
  } else {
    await w3n.log('error', `Fail to tell own devices that the call was handled here`, result.err);
  }
}

/**
 * Passes the host's heartbeat on to the user's other devices, so that one of
 * them which the host's messages never reach still learns that a call is going
 * on and who hosts it.
 *
 * Sent to the user's own address, the same route as sendCallHandledElsewhere
 * and for the same reason: in the run of 2026-08-16 a device received nothing
 * whatsoever from the host - not one of four copies of 'start', not one
 * heartbeat - while messages from its own address kept arriving throughout (see
 * `relayedRejoin` in asmail-msgs.types.ts). The host cannot fix that by sending
 * more copies; a neighbouring device can, because a different sender is exactly
 * what the blind subscription is not blind to.
 *
 * The stamp is fresh, not the host's. What the receiver measures against
 * HEARTBEAT_MAX_AGE_MILLIS is how long ago the beat was sent, and a hostile
 * reading of a re-stamp - "an old beat made to look new" - cannot happen here:
 * the caller relays only a beat `admitsHeartbeat` has just accepted, i.e. one
 * under 45s old, and it relays it at once. Keeping the host's stamp instead
 * would add this device's own ASMail leg to an already-spent budget and fail the
 * receiver's age gate for no gain. A call that has ENDED is caught by the record
 * the end left behind (`endedBy: 'host'` → drop-ended-session), and by the plain
 * fact that a device with no beats to take has none to pass on.
 *
 * Not sendHeartbeat(): that one addresses many recipients and registers a resend
 * budget against delivery failures. Here there is a single recipient and the
 * next beat is 15s away, which is the only resend this needs.
 */
export async function relayRejoinHeartbeat(
  chatId: ChatIdObj,
  ownAddr: string,
  deviceId: string,
  hostAddr: string,
  callSessionId?: string,
): Promise<void> {
  const result = await sendWebRTCSignal({
    chatId,
    recipient: ownAddr,
    webrtcMsg: {
      stage: 'heartbeat',
      id: Date.now(),
      callSessionId,
      // `hostAddr` is what the receiver joins as a client to, exactly as in a
      // heartbeat straight from the host - the receiving path reads this
      // relayed beat with the same rules, only taking the host from here rather
      // than from the envelope, which names this device.
      data: { hostAddr, relayedRejoin: { byDeviceId: deviceId } },
    },
    deliveryIdPrefix: 'chat-rejoin-relay',
    logLabel: '[relayRejoinHeartbeat]',
    signalName: 'relayed-heartbeat',
    confirm: true,
    blindRepeats: { delaysMillis: [BLIND_REPEAT_DELAY_MILLIS] },
  });

  if (result.ok) {
    log.debug(
      `[relayRejoinHeartbeat] Passed the heartbeat of ${hostAddr} on to own devices`,
    );
  } else {
    await w3n.log(
      'error', `Fail to pass the heartbeat of ${hostAddr} on to own devices`, result.err,
    );
  }
}

/**
 * Stages whose delivery is confirmed via observeDelivery() rather than just
 * fire-and-forget addMsg(). These are singular, latency-critical messages
 * where the caller can meaningfully react to a delivery failure (fast retry).
 *
 * NOTE: globally gated by CONFIRM_DELIVERY_ENABLED in webrtc-signalling.ts (on
 * again as of 2026-08-13); while that is off, these are sent fire-and-forget
 * with the blind repeat schedules below instead.
 */
const CONFIRMED_DELIVERY_STAGES: ReadonlySet<WebRTCMsg['stage']> = new Set([
  'start',
  'disconnect',
]);

/**
 * Stages that get an automatic delivery retry on failure (in addition to
 * confirmed delivery). 'disconnect' is retried because, unlike offer/answer
 * (which are re-sent by their own negotiation retry loops on the WebRTC
 * layer), a lost 'disconnect' has no other retry path — the remote side only
 * discovers the call ended via a (much slower) ICE connection timeout.
 */
const RETRY_ON_FAILURE_STAGES: ReadonlySet<WebRTCMsg['stage']> = new Set([
  'disconnect',
]);
const DELIVERY_RETRY_ATTEMPTS = 2;
/**
 * Pause between a send that came back unconfirmed and the next attempt.
 *
 * Was 1.5 s while CONFIRM_DELIVERY_ENABLED was off and this code path was dead.
 * With confirmation on it is live, and 1.5 s is counterproductive: an
 * unconfirmed send means the server is struggling with disk writes (the 500
 * storms of 2026-08-10/13), and the attempt it just spent 20-30 s waiting on may
 * yet be delivered. Haste here only adds a copy to the queue that caused it.
 */
const DELIVERY_RETRY_DELAY_MILLIS = 5_000;

/**
 * Delay of the single blind fire-and-forget repeat of one-shot signals
 * (call-full, call-declined, call-handled-elsewhere). Only used with delivery
 * confirmation off (CONFIRM_DELIVERY_ENABLED=false), where the confirm+retry
 * pairs above never fire and these signals have no other recovery path; with it
 * on, the confirmation replaces them (see `blindRepeats` in
 * webrtc-signalling.ts).
 */
const BLIND_REPEAT_DELAY_MILLIS = 4000;

/**
 * Repeat schedule for 'disconnect', the one signal whose loss the user sees
 * directly: without it the peer's call window stays open until its own
 * host-silence watchdog gives up (90s) — or forever, if that watchdog is
 * disqualified. So it gets a schedule rather than a single 4s dubbing:
 *
 * - 4s: the previous behaviour, catches a momentary hiccup;
 * - 20s: past the measured one-way ASMail latency, for a send that went out
 *   while the transport was degrading;
 * - 60s: outlives a short 500-storm on the server, which is what actually ate
 *   the 'disconnect' in the group-call failure of 2026-08-11.
 *
 * Safe to schedule this far out because these repeats run in the deno
 * background process, which outlives the call window that started them.
 *
 * Inert while CONFIRM_DELIVERY_ENABLED is on: 'disconnect' is a confirmed stage,
 * and a confirmed send skips its blind repeats. Kept as the fallback for the flag
 * being turned off, and as the record of what a lost departure costs.
 */
const TEARDOWN_REPEAT_DELAYS_MILLIS = [4_000, 20_000, 60_000];

/**
 * Repeat schedule for 'start', the signal that decides whether a call happens
 * at all.
 *
 * It used to have none: a single HTTP 500 on the delivery of 'start' left the
 * invited peers with no idea a call was going on, and the host with a log line
 * claiming success (group call of 2026-08-12, both invitations lost to the same
 * burst). The other recovery paths cannot help there — 'request-start' needs the
 * peer to have received some *other* signal of this call, and the host's
 * heartbeat only begins once somebody has joined.
 *
 * - 3s: a momentary hiccup, re-sent while the caller is still waiting to hear
 *   the ringback;
 * - 12s: past the measured one-way ASMail latency (7-12s), for a send that went
 *   out while the transport was degrading;
 * - 30s: outlives a short 500-storm, and still lands inside the invitee's
 *   ringing window (RINGING_NO_ANSWER_TIMEOUT_MILLIS = 90s), so an accepted
 *   repeat can still turn into a call.
 *
 * Unlike teardown repeats, these are NOT inert on arrival: a 'start' that lands
 * after the host gave up rings a phantom call. Hence the mandatory `stillNeeded`
 * gate from the caller (see inviteStillPending in call.ts) - which the confirmed
 * path applies to its retries too.
 *
 * Unlike the teardown schedule above, this one runs even while
 * CONFIRM_DELIVERY_ENABLED is on (`evenWhenConfirmed`). Confirmation proves the
 * invitation reached the invitee's inbox, and an inbox belongs to an address
 * rather than to a device: with several devices behind one address, a confirmed
 * 'start' can still be seen by only some of them (measured 2026-08-15 - one
 * device of a two-device user rang, the other never surfaced the message at all
 * although its inbox subscription was live and the message stayed in the shared
 * inbox for 55s). 'start' is the only signal that has to reach EVERY device of
 * an address, so it is the only one for which the inbox is not proof enough.
 */
const START_REPEAT_DELAYS_MILLIS = [3_000, 12_000, 30_000];

export function repeatScheduleFor(
  stage: WebRTCMsg['stage'], opts: SendWebRTCMsgOpts | undefined,
): { delaysMillis: number[]; stillNeeded?: () => boolean; evenWhenConfirmed?: boolean } | undefined {
  if (stage === 'disconnect') {
    return { delaysMillis: TEARDOWN_REPEAT_DELAYS_MILLIS };
  }
  if (stage === 'start') {
    // No predicate, no repeats: a caller that cannot say whether the invitation
    // still stands must not have copies of it fired off behind its back, since a
    // late 'start' rings a call that may no longer exist.
    return opts?.stillNeeded
      ? {
        delaysMillis: START_REPEAT_DELAYS_MILLIS,
        stillNeeded: opts.stillNeeded,
        evenWhenConfirmed: true,
      }
      : undefined;
  }
  return undefined;
}

export interface SendWebRTCMsgOpts {
  /**
   * Checked before every repeat of this signal; `false` cancels the rest. Required
   * for 'start', whose repeats are not inert (see START_REPEAT_DELAYS_MILLIS).
   */
  stillNeeded?: () => boolean;
  /**
   * Called when the platform reported the signal as undelivered and the resends
   * it triggered are spent. For telling the user; the recovery has been tried.
   */
  onUndelivered?: (peerAddr: string, err: unknown) => void;
}

export async function sendWebRTCMsg(
  chatId: ChatIdObj,
  peerAddr: string,
  ownAddr: string,
  webrtcMsg: WebRTCMsg,
  opts?: SendWebRTCMsgOpts,
): Promise<boolean> {
  // Independent of whether the signal itself gets through: the system message
  // makes the cancelled call visible in the chat history, and doubles as the
  // client's fallback teardown path (see 'outgoing-call-cancelled' handling in
  // video-chat-service.ts). Sent alongside the signal, not after it: waiting
  // out the signal's confirm+retry cycle first would delay exactly the
  // scenario where this fallback matters.
  const sysMsgSent = (webrtcMsg.stage === 'disconnect')
    ? sendSystemMgsAboutDisconnectWebRTC({
      ownAddr, chatId, recipients: [peerAddr], callSessionId: webrtcMsg.callSessionId,
    }).catch(err => w3n.log('error', `Fail to send system message about webrtc disconnect`, err))
    : undefined;

  const { ok } = await sendWebRTCSignal({
    chatId,
    recipient: peerAddr,
    webrtcMsg,
    deliveryIdPrefix: 'chat-webrtc',
    logLabel: '[sendWebRTCMsg]',
    confirm: CONFIRMED_DELIVERY_STAGES.has(webrtcMsg.stage),
    retries: RETRY_ON_FAILURE_STAGES.has(webrtcMsg.stage)
      ? { attempts: DELIVERY_RETRY_ATTEMPTS, delayMillis: DELIVERY_RETRY_DELAY_MILLIS }
      : undefined,
    blindRepeats: repeatScheduleFor(webrtcMsg.stage, opts),
    // The two signals whose loss strands a call: 'start' never rings the peer,
    // 'disconnect' never closes its window. Both deserve a resend the moment the
    // platform admits the delivery failed, rather than only their fixed schedule.
    reportFailure: CONFIRMED_DELIVERY_STAGES.has(webrtcMsg.stage),
    onFailure: opts?.onUndelivered,
  });

  await sysMsgSent;

  return ok;
}
