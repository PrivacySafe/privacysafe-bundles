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
import type { WebRTCMsg } from '../../../types/asmail-msgs.types.ts';
import type { VideoChatEvent } from '../../../types/services.types.ts';
import type { CallInChat, ChatSrv, ChatSrvEmit, DB, LocalDataStore } from '../../types/index.ts';
import type { BlacklistTracker } from '../contacts-service/contacts-blacklist.ts';
import { ObserversSet } from '../../../shared-libs/observer-utils.ts';
import type { CallSessions } from './utils/call-state.ts';
import { createCallSessions } from './utils/call-state.ts';
import { AppSettings } from '../../utils/app-settings.ts';
import { makeLogger } from '../../../shared-libs/logger.ts';

const log = makeLogger('VideoChatService');

/** A WebRTC signal held until the call object it is for exists. */
export interface PendingSignal {
  sender: string;
  webrtcMsg: WebRTCMsg;
  msgId: string;
  bufferedAt: number;
}

/**
 * What the parts of the video chat service share: the arguments of
 * videoChatService() and the state of its calls.
 *
 * Made once per service. Collections are mutated in place and never replaced,
 * so a module may take them out of here once, at its construction. Each one is
 * documented where it is created, in createVideoChatCtx().
 */
export interface VideoChatCtx {
  readonly ownAddr: string;
  readonly chatSrv: ChatSrv;
  readonly db: DB;
  readonly emit: ChatSrvEmit;
  readonly localDataStore: LocalDataStore;
  readonly blacklistTracker?: BlacklistTracker;
  readonly videoChatsObs: ObserversSet<VideoChatEvent>;
  /** Events for the GUI (= videoChatsObs.next). */
  readonly sinkGUIEvents: (event: VideoChatEvent) => void;
  readonly appSettings: AppSettings;
  readonly sessions: CallSessions;
  readonly calls: Map<string, CallInChat>;
  readonly pendingSignals: Map<string, PendingSignal[]>;
  readonly signalsLeftInInbox: Map<string, Set<string>>;
  readonly callRecordIds: Map<string, string>;
  readonly answeredAsInCall: Set<string>;
  readonly collisionNoticesSent: Set<string>;
  readonly lastRejoinRelayAt: Map<string, { at: number; callSessionId?: string }>;
}

export function createVideoChatCtx(
  ownAddr: string,
  chatSrv: ChatSrv,
  db: DB,
  emit: ChatSrvEmit,
  localDataStore: LocalDataStore,
  blacklistTracker?: BlacklistTracker,
): VideoChatCtx {
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

  return {
    ownAddr,
    chatSrv,
    db,
    emit,
    localDataStore,
    blacklistTracker,
    videoChatsObs,
    sinkGUIEvents: videoChatsObs.next,
    appSettings,
    sessions,
    calls,
    pendingSignals,
    signalsLeftInInbox,
    callRecordIds,
    answeredAsInCall,
    collisionNoticesSent,
    lastRejoinRelayAt,
  };
}
