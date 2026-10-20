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
 * Reading a WebRTC signal out of an incoming ASMail message body.
 *
 * Kept apart from _common.ts, which sends signals and therefore pulls in the
 * mail-sending service (and, through it, the whole storage stack). Everything
 * here is pure - types, address utilities, no `w3n` - so the rules below are
 * directly testable (see "Test Suite 9" in tests-app/src/tests/video-chat.ts).
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
import type {
  ChatIdObj,
  ChatIncomingMessage,
  ChatWebRTCMsgV1,
  WebRTCMsg,
  WebRTCOffBandMessage,
} from '../../../../types/asmail-msgs.types.ts';
import { areAddressesEqual, toCanonicalAddress } from '../../../../shared-libs/address-utils.ts';
import type { SignalAge } from './call-state.ts';

function checkData(data: WebRTCOffBandMessage | WebRTCOffBandMessage[]): boolean {
  // TODO add sanity checks here, and for outgoing thing we may add filtering
  return true;
}

export interface WebRTCMsgInChat {
  webrtcMsg: ChatWebRTCMsgV1['webrtcMsg'];
  /** Chat this signal is about. */
  chatId: ChatIdObj;
  /**
   * Sent by another device of this same user, to the user's own address (see
   * sendCallHandledElsewhere in _common.ts). Decides whether `chatId` may be
   * taken from the body.
   */
  fromOwnDevice: boolean;
}

/**
 * Reads `chatId` as the sending device wrote it into the body.
 *
 * Only ever consulted for a message from one of our own devices: a *peer* must
 * not be able to name the chat its signals land in, or it could inject
 * signalling into a one-to-one chat it has nothing to do with. For a peer, the
 * chat is derived from the envelope instead, which it cannot forge.
 */
function chatIdFromBody(chatId: ChatIdObj | undefined): ChatIdObj | undefined {
  if (!chatId || (typeof chatId.chatId !== 'string') || !chatId.chatId) {
    return undefined;
  }
  if (chatId.isGroupChat) {
    // A group chat id is never an address; one that looks like an address is a
    // one-to-one id in the wrong field.
    return chatId.chatId.includes('@')
      ? undefined
      : { isGroupChat: true, chatId: chatId.chatId };
  }
  if (!chatId.chatId.includes('@')) {
    return undefined;
  }
  // The sending device may have taken the peer address from a view model, where
  // it is not necessarily canonical.
  return { isGroupChat: false, chatId: toCanonicalAddress(chatId.chatId) };
}

export function checkChatMessageJSONforWebRTC(
  msg: ChatIncomingMessage, ownAddr: string,
): WebRTCMsgInChat | undefined {
  const { sender, jsonBody } = msg;
  if (msg.jsonBody.v !== 1) {
    return;
  }

  const {
    chatMessageType, groupChatId, chatId: chatIdInBody, webrtcMsg,
  } = jsonBody as ChatWebRTCMsgV1;

  if (chatMessageType !== 'webrtc-call' || !webrtcMsg) {
    return;
  }

  const { id, stage, data } = webrtcMsg;

  if (typeof stage !== 'string' || typeof id !== 'number' || !checkData(data)) {
    return;
  }

  const fromOwnDevice = areAddressesEqual(sender, ownAddr);

  // A signal addressed to the user's own address has to name its chat
  // explicitly: deriving a one-to-one chat from the sender would give the
  // "chat with oneself", which does not exist. Signals from a peer keep being
  // derived from the envelope, whatever their body claims.
  const chatId: ChatIdObj | undefined = fromOwnDevice
    ? chatIdFromBody(chatIdInBody)
    : undefined;

  if (chatId) {
    return { chatId, webrtcMsg, fromOwnDevice };
  }

  const derivedChatId: ChatIdObj =
    typeof groupChatId === 'string' && groupChatId
      ? { isGroupChat: true, chatId: groupChatId }
      : { isGroupChat: false, chatId: toCanonicalAddress(sender) };

  if (derivedChatId.isGroupChat && derivedChatId.chatId.includes('@')) {
    return;
  }

  // NOTE: a message from one of our own devices running a build that predates
  // `chatId` in the body lands here with the "chat with oneself" id. It is
  // unresolvable - guessing the chat from whichever call happens to be ringing
  // would be worse than doing nothing - so its handling amounts to logging and
  // a deferred removal. That is exactly what such a build got before this
  // field existed, i.e. not a regression.
  return { chatId: derivedChatId, webrtcMsg, fromOwnDevice };
}

/**
 * How old an incoming signal is, by both clocks (see SignalAge in call-state.ts).
 *
 * `id === 0` is read as "no send stamp", not as the first millisecond of 1970.
 * A sender on a build that stamped a constant there (heartbeats before
 * 2026-08-13) would otherwise fail every age gate, however fresh the message —
 * and since the age verdict is logged at `debug`, that failure is invisible in
 * an ordinary log. `sinceDelivery` still covers such a signal: the receiving
 * side stamps `deliveryTS` itself and no peer can influence it.
 *
 * A stamp in the future (a sender whose clock runs ahead) is clamped to 0
 * rather than left negative, so that "fresher than possible" cannot cancel out
 * a genuinely old delivery stamp in any caller that sums or compares the two.
 */
export function signalAgeOf(
  webrtcMsg: Pick<WebRTCMsg, 'id'>, deliveryTS: number, now: number,
): SignalAge {
  const senderStamp = webrtcMsg.id;
  const fromSenderClock = (typeof senderStamp === 'number') && (senderStamp > 0)
    ? Math.max(0, now - senderStamp)
    : 0;
  return {
    fromSenderClock,
    sinceDelivery: Math.max(0, now - deliveryTS),
  };
}

/**
 * The first item of a signal body, whichever of the two shapes it came in.
 *
 * `WebRTCMsg.data` is either one off-band message or an array of them, and
 * every reader of a specific field has to cope with both.
 */
function firstBodyItemOf(
  webrtcMsg: Pick<WebRTCMsg, 'data'>,
): WebRTCOffBandMessage | undefined {
  const { data } = webrtcMsg;
  return Array.isArray(data) ? data[0] : data;
}

/**
 * Whether this signal is a re-joining client's "I am on my way" notice.
 *
 * The notice exists because the host learns of a return from the returning
 * client's SDP offer and from nothing else - and that offer is the largest
 * message in the protocol (13-21 KB, growing with every ICE candidate that
 * lands in `localDescription` before a repeat). In the group call of
 * 2026-08-13 the other participants sat for 50s with no sign that anyone was
 * coming back. This one is ~250 B on the same ASMail path.
 *
 * Told apart from everything else by the `rejoining` field alone: an offer, a
 * candidate, a 'candidates' batch and a heartbeat carry a `description` or a
 * `candidate` and never this, and `callDeclined` is a different field of the
 * same shape.
 */
export function isRejoinNotice(webrtcMsg: Pick<WebRTCMsg, 'data'>): boolean {
  const by = firstBodyItemOf(webrtcMsg)?.rejoining?.by;
  return (typeof by === 'string') && (by.length > 0);
}

/**
 * When a re-join notice is repeated, counted from the first copy.
 *
 * The notice rides `stage: 'signalling'`, which is fire-and-forget with
 * neither confirmation nor a resend, and in the group call of 2026-08-13 19:36
 * that cost the whole feature: the notice went out at the right moment - 79s
 * before the offer reached the host - and died on a single 500 from
 * `/asmail/delivery/msg/obj`. Three copies of a ~250 B message are a rounding
 * error next to the 21 KB offer they run ahead of.
 *
 * Both delays sit inside the window where the notice is still the faster news:
 * the returning client's own offer is confirmed-or-not at ~25s and repeated at
 * 45s (OFFER_RETRY_DELAYS), and past that the offer is its own announcement.
 * Spaced rather than burst, because a burst is exactly what a 500 storm
 * punishes.
 */
export const REJOIN_NOTICE_REPEAT_DELAYS_MILLIS = [10_000, 30_000];

/**
 * The notice itself.
 *
 * `id` is the sender's stamp, and `now` is passed in rather than read here so
 * that the value is the caller's to control (and the rule is testable). It
 * must never be 0: `signalAgeOf` reads 0 as "no stamp", and the host's arrival
 * gate deduplicates ASMail's repeats by exactly this number.
 *
 * `stage: 'signalling'`, not a stage of its own: every stage is a branch in
 * several receivers, and a peer on an older build would meet an unknown one.
 * As a signalling message with a field it does not know, the notice is simply
 * ignored there - which is the correct fallback, since the offer still comes.
 */
export function rejoinNoticeMsg(
  callSessionId: string | undefined, by: string, now: number,
): WebRTCMsg {
  return {
    stage: 'signalling',
    id: now,
    callSessionId,
    data: { rejoining: { by } },
  };
}

export function startStageFirst(a: WebRTCMsg, b: WebRTCMsg): -1 | 0 | 1 {
  if (a.stage === 'start') {
    return -1;
  }

  if (b.stage === 'start') {
    return 1;
  }

  return 0;
}
