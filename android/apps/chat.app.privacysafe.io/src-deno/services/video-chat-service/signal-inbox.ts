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
import type { CallInChat } from '../../types/index.ts';
import { chatIdToString } from '../../../shared-libs/chat-ids.ts';
import { removeMessageFromInbox, removeMessagesFromInboxBatch } from '../../utils/inbox-utils.ts';
import { checkChatMessageJSONforWebRTC } from './utils/_common.ts';
import type { CallCancelSysMsgVerdict, SignalVerdict } from './utils/call-state.ts';
import { HEARTBEAT_RETENTION_MILLIS, MSG_REMOVAL_DELAY_MILLIS } from './constants.ts';
import { makeLogger } from '../../../shared-libs/logger.ts';
import type { VideoChatCtx } from './video-chat-ctx.ts';

const log = makeLogger('VideoChatService');

// Buffered non-start WebRTC signals (offer/ICE/disconnect arriving before a
// CallInChat exists) are dropped, and their inbox messages removed, if no
// 'start' shows up to create the call within this window. This protects
// against unbounded memory growth and inbox clutter from truly orphaned
// signals (e.g. a lone leftover ICE candidate for a call whose 'start' was
// already consumed in a previous run).
// Must outlive the recovery it exists for: the request-start round trip is
// two ASMail legs (20-40s+ at measured latency) plus the host's queueing —
// the former 45s routinely expired before the re-sent 'start' arrived.
export const PENDING_SIGNAL_TTL_MILLIS = 120_000;

/**
 * Signals of a chat between their arrival and their removal from the inbox:
 * buffered until a call exists, handed to the call, left in the inbox until
 * teardown, or dropped - with the reason logged.
 */
export function makeSignalInbox(ctx: VideoChatCtx) {
  const { ownAddr, sessions, pendingSignals, signalsLeftInInbox } = ctx;

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

  return {
    rememberSignalLeftInInbox,
    logDroppedSignal,
    dropSignal,
    purgeStaleWebRTCMessages,
    forwardSignalToCall,
    drainPendingSignals,
    startupPurgeTimer,
  };
}

export type SignalInbox = ReturnType<typeof makeSignalInbox>;
