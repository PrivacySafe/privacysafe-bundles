/*
 Copyright (C) 2025 3NSoft Inc.

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
 * Video Chat Service — placeholder for Star (Host-Client) architecture.
 *
 * Previous Mesh logic (per-peer signaling channels, listeners map) has been removed.
 * This service currently provides:
 * - IPC interface implementation (VideoChatComponent)
 * - Chat info storage
 * - GUI request observation
 *
 * Star architecture logic is implemented:
 * - Host/Client role-based signal handling via handleWebRTCSignal
 * - Single signaling channel to host (for clients) via clientSignalingChannel
 * - Signal routing from clients (for host) via hostSignalingChannel
 */

import { shallowRef, watch } from 'vue';
import { useStreamsStore } from '@video/common/store/streams.store';
import { makeLogger, setLogRelay } from '@shared/logger';
import { makeBatchingLogRelay, shouldRelayLogs } from '@shared/log-relay';
import type {
  CallFromVideoGUI,
  ChatInfoForCall,
  VideoChatComponent,
  WebRTCMsg,
} from '~/index';

const log = makeLogger('VideoChatSrv');

/** Full hangup path from use-in-calls (channels + store + closeSelf). */
let fullEndCallHandler: (() => Promise<void>) | undefined;
let endCallInFlight = false;

/** Sink for GUI->background requests, set while the call page is active. */
let guiRequestSink: ((req: CallFromVideoGUI) => void) | undefined;

/** Sends whatever this window has logged but not yet relayed; see below. */
let flushLogRelay: (() => void) | undefined;

/**
 * Sends this window's log lines to the background, which prints them into the
 * output the whole run is read from (see the 'gui-log' event of
 * CallFromVideoGUI).
 *
 * This window is the one that needs it most: it exists only while the call
 * does, so its devtools console goes with it, and until now nothing of what it
 * saw survived the call.
 *
 * The channel is the observer the background subscribes to - this window opens
 * no outgoing RPC of its own - so lines written before that subscription (the
 * whole of the window's start-up) wait in the relay's buffer and go out with
 * the first batch after.
 *
 * Does nothing outside the test stand - see shouldRelayLogs() for why. In a
 * production run this window's own `w3n.log` already puts every one of these
 * lines into the platform's log file; what is lost with the relay is the
 * `[GUI:video]` prefix, which is how the moment a frozen background component
 * stopped answering was pinned down to the second.
 */
export function startCallWindowLogRelay(): void {
  if (!shouldRelayLogs(w3n as { testStand?: unknown })) {
    return;
  }
  const { relay, flush } = makeBatchingLogRelay(() => (
    guiRequestSink
      ? lines => guiRequestSink!({ type: 'gui-log', lines })
      : undefined
  ));
  flushLogRelay = flush;
  setLogRelay(relay);
}

/**
 * Notify the background (Deno) that the host ended the call, as reported by
 * the client's signaling channel ('disconnect' from Host). Deno performs the
 * actual GUI teardown (endCallInGUI) and shows a notice in the main window.
 */
export function notifyHostEndedCall(): void {
  guiRequestSink?.({ type: 'host-ended-call' });
}

/**
 * Notify the background (Deno) that a group-call client has left, as soon as
 * the host's own channel saw it (in-band 'disconnect', signaling channel
 * close, or grace timeout). Deno drops the client from its bookkeeping and
 * sends it the out-of-cycle re-join heartbeat without waiting for the much
 * slower ASMail 'disconnect' to arrive.
 */
export function notifyPeerLeftCall(peerAddr: string): void {
  guiRequestSink?.({ type: 'peer-left-call', peerAddr });
}

/**
 * Register UI-level full endCall. Returns unregister.
 * Called from use-in-calls when call page is active.
 */
export function registerFullEndCall(handler: () => Promise<void>): () => void {
  fullEndCallHandler = handler;
  return () => {
    if (fullEndCallHandler === handler) {
      fullEndCallHandler = undefined;
    }
  };
}

/** UI-level handler for an invited peer declining the call. Set by use-in-calls. */
let callDeclinedHandler: ((peerAddr: string) => void) | undefined;

/**
 * Register UI-level handler for 'call declined' signals. Returns unregister.
 * Called from use-in-calls when call page is active.
 */
export function registerCallDeclinedHandler(handler: (peerAddr: string) => void): () => void {
  callDeclinedHandler = handler;
  return () => {
    if (callDeclinedHandler === handler) {
      callDeclinedHandler = undefined;
    }
  };
}

/**
 * UI-level handler for a group-call client leaving (graceful ASMail
 * 'disconnect' fallback path, when the low-latency DC signal didn't arrive
 * in time). Set by use-in-calls to endCallWhenPeerCloses, which calls
 * hostChannel.removeClient() — the same full removal path (participant-left
 * broadcast + sender cleanup + notice) as the DC-signaled 'disconnect'.
 */
export interface PeerLeftParams {
  peerAddr: string;
  /**
   * When the peer sent this departure, on the peer's own clock (WebRTCMsg.id —
   * the same field that becomes StarSignalMessage.msgTs). A departure is
   * repeated blindly over a minute, and a copy that lands after the peer has
   * re-joined must not tear its fresh connection down; the host compares this
   * against the pc generation it is currently serving them on. Absent for a
   * peer on a build that sends no stamp, which keeps the previous behaviour.
   */
  sentAt?: number;
}

let peerLeftHandler: ((params: PeerLeftParams) => Promise<void>) | undefined;

/**
 * Register UI-level handler for a client leaving the call. Returns unregister.
 * Called from use-in-calls when call page is active.
 */
export function registerPeerLeftHandler(
  handler: (params: PeerLeftParams) => Promise<void>,
): () => void {
  peerLeftHandler = handler;
  return () => {
    if (peerLeftHandler === handler) {
      peerLeftHandler = undefined;
    }
  };
}

/**
 * UI-level handler for the host's heartbeat (client side, group call). The
 * background forwards it into this window as the host's "still here", so the
 * client channel's host-silence watchdog can tell "host ended/gone" from
 * "host alive, big-message delivery broken". Set by use-in-calls.
 */
let hostHeartbeatHandler: (() => void) | undefined;

/**
 * Register UI-level handler for the host's heartbeat. Returns unregister.
 * Called from use-in-calls when call page is active.
 */
export function registerHostHeartbeatHandler(handler: () => void): () => void {
  hostHeartbeatHandler = handler;
  return () => {
    if (hostHeartbeatHandler === handler) {
      hostHeartbeatHandler = undefined;
    }
  };
}

/**
 * UI-level handler for an invitation the platform failed to deliver (host side).
 * Set by use-in-calls, which marks that participant as not reached and says so.
 */
let undeliveredInviteHandler: ((peerAddr: string) => void) | undefined;

/**
 * Register UI-level handler for undelivered invitations. Returns unregister.
 * Called from use-in-calls when call page is active.
 */
export function registerUndeliveredInviteHandler(
  handler: (peerAddr: string) => void,
): () => void {
  undeliveredInviteHandler = handler;
  return () => {
    if (undeliveredInviteHandler === handler) {
      undeliveredInviteHandler = undefined;
    }
  };
}

/**
 * UI-level handler for a peer announcing its return to the call (host side).
 * Set by use-in-calls, which is where the host channel lives - the store keeps
 * only the *signalling* channel, and announcing a re-join needs the host
 * channel's own view of who is connected and of the reconnect hints it sent.
 */
let rejoiningPeerHandler: ((peerAddr: string) => void) | undefined;

/**
 * Register UI-level handler for re-join notices. Returns unregister.
 * Called from use-in-calls when call page is active.
 */
export function registerRejoiningPeerHandler(
  handler: (peerAddr: string) => void,
): () => void {
  rejoiningPeerHandler = handler;
  return () => {
    if (rejoiningPeerHandler === handler) {
      rejoiningPeerHandler = undefined;
    }
  };
}

/** Whom a window that gave way to another call now joins; see switchToClientOf. */
export interface RoleSwitchTarget {
  hostAddr: string;
  callSessionId?: string;
}

/**
 * Handler of the page currently mounted - the media setup screen or the call
 * page - for turning this window from the host of its own call into a client of
 * the call that won a collision with it. The two pages do different things (one
 * relabels a button, the other swaps its WebRTC channel), and only one of them
 * is mounted at a time.
 */
let roleSwitchHandler: ((target: RoleSwitchTarget) => void) | undefined;

/**
 * Register the mounted page's handler for switching to a client. Returns
 * unregister.
 */
export function registerRoleSwitchHandler(
  handler: (target: RoleSwitchTarget) => void,
): () => void {
  roleSwitchHandler = handler;
  return () => {
    if (roleSwitchHandler === handler) {
      roleSwitchHandler = undefined;
    }
  };
}

export function useVideoChatSrv(): VideoChatComponent {
  const streamsStore = useStreamsStore();

  /* video chat service methods */
  const ctrlObs = shallowRef<web3n.Observer<CallFromVideoGUI> | undefined>(undefined);
  const chat = shallowRef<ChatInfoForCall | undefined>(undefined);

  async function startVideoCallComponentForChat(value: ChatInfoForCall): Promise<void> {
    if (chat.value) {
      throw `Chat room is already set for this window`;
    }
    chat.value = value;
    passInitialDataToStreamsStore();
  }

  async function focusWindow(): Promise<void> {
    // Note: This method is not needed — the GUI service handles window focus automatically.
  }

  /**
   * Full teardown (same path as user hangup):
   * registered handler closes channels + streams + closeSelf;
   * fallback if call page not mounted yet.
   * Idempotent: concurrent/repeated calls are no-ops.
   */
  async function endCall(): Promise<void> {
    if (endCallInFlight) {
      console.log('[VideoChatSrv] endCall() already in flight — skip');
      return;
    }
    endCallInFlight = true;
    try {
      if (fullEndCallHandler) {
        console.log('[VideoChatSrv] endCall() — via registered full handler');
        await fullEndCallHandler();
        return;
      }
      console.log('[VideoChatSrv] endCall() — fallback (no UI handler)');
      await streamsStore.endCall();
      try {
        w3n.closeSelf();
      } catch (err) {
        console.warn('[VideoChatSrv] closeSelf failed (already closed?)', err);
      }
    } finally {
      endCallInFlight = false;
    }
  }

  /**
   * Handle WebRTC signal — routes signals to the appropriate signaling channel.
   *
   * For Host: receives signals from clients and routes to host signaling channel.
   * For Client: receives signals from host and routes to client signaling channel.
   *
   * Special handling for 'disconnect' stage:
   * - Host 1-1: full endCall (close window)
   * - Host group: full client removal via peerLeftHandler (ASMail fallback
   *   path — the low-latency DC 'disconnect' signal normally beats this)
   * - Client: usually handled in call.ts via endCallInGUI; if signal reaches here — full end
   */
  async function handleWebRTCSignal(peerAddr: string, msg: WebRTCMsg): Promise<void> {
    console.log('[VideoChatSrv] handleWebRTCSignal()', {
      peerAddr,
      stage: msg.stage,
      isHost: streamsStore.isHost,
      isClient: streamsStore.isClient,
      hasDescription: !!(msg.data && 'description' in msg.data && msg.data.description),
      sdpPreview: msg.data && 'description' in msg.data && msg.data.description
        ? msg.data.description.sdp?.substring(0, 80)
        : 'N/A',
    });

    // Signals of another call must not be acted on, and above all must not be
    // mistaken for signs of life: EVERY inbound signal refreshes the
    // host-silence watchdog (see noteHostActivity in client-channel.ts), so a
    // straggler of a finished session was enough to keep postponing the verdict
    // that the host is gone — and with it the closing of a dead call window.
    // An absent id means an older peer; those stay accepted as before.
    const ownSessionId = streamsStore.callSessionId;
    if (msg.callSessionId && ownSessionId && (msg.callSessionId !== ownSessionId)) {
      console.warn(
        `[VideoChatSrv] Dropping '${msg.stage}' from ${peerAddr} of foreign session `
        + `${msg.callSessionId} (ours: ${ownSessionId})`,
      );
      return;
    }

    // Handle 'callDeclined' directly — sent as a 'signalling' stage payload
    // (same idiom as 'callFull') by an invited peer who pressed "Decline".
    const rawData = Array.isArray(msg.data) ? msg.data[0] : msg.data;
    if (rawData?.callDeclined) {
      console.log(`[VideoChatSrv] ${peerAddr} declined the call`);
      callDeclinedHandler?.(peerAddr);
      return;
    }

    // Host's heartbeat forwarded by the background (client side, group call):
    // pure liveness for the host-silence watchdog. Not a Star signal — the
    // signaling channel's parser would drop it silently, so it is consumed
    // here.
    if (msg.stage === 'heartbeat') {
      if (streamsStore.isClient) {
        hostHeartbeatHandler?.();
      }
      return;
    }

    // Handle 'disconnect' stage directly — this signal is sent via sendWebRTCMsg
    // and doesn't contain StarSignalData in the description field.
    if (msg.stage === 'disconnect') {
      if (streamsStore.isHost) {
        if (!streamsStore.isGroupChat) {
          // 1-1: peer left → full hangup (window must close)
          console.log(`[VideoChatSrv] Host 1-1: peer ${peerAddr} disconnected — full endCall`);
          await endCall();
        } else {
          // Group: full removal (participant-left broadcast + sender cleanup
          // + notice) via the same path as the low-latency DC 'disconnect'
          // signal. Fallback to a bare store removal if the call page isn't
          // mounted yet (handler not registered) — better than dropping the
          // signal silently.
          console.log(`[VideoChatSrv] Host group: client ${peerAddr} disconnected, removing`);
          if (peerLeftHandler) {
            // With the send time: a departure is repeated blindly for a minute,
            // and the handler drops a copy that predates the connection the
            // client is being served on right now (see isStaleClientDisconnect).
            await peerLeftHandler({ peerAddr, sentAt: msg.id });
          } else {
            streamsStore.removeRemoteParticipant(peerAddr);
          }
        }
      } else if (streamsStore.isClient) {
        // Defense in depth if disconnect is forwarded to GUI
        console.log('[VideoChatSrv] Client: host disconnect signal — full endCall');
        await endCall();
      }
      return;
    }

    if (streamsStore.isHost && streamsStore.hostSignalingChannel) {
      // Host: route signal from client to host signaling channel
      console.log(`[VideoChatSrv] Routing signal from client ${peerAddr} to host channel`);
      streamsStore.hostSignalingChannel.handleWebRTCMsg(peerAddr, msg);
    } else if (streamsStore.isClient && streamsStore.clientSignalingChannel) {
      // Client: route signal from host to client signaling channel
      console.log(`[VideoChatSrv] Routing signal from host to client channel`);
      streamsStore.clientSignalingChannel.handleWebRTCMsg(msg);
    } else {
      console.warn('[VideoChatSrv] handleWebRTCSignal: no signaling channel available', {
        isHost: streamsStore.isHost,
        isClient: streamsStore.isClient,
        hasHostChannel: !!streamsStore.hostSignalingChannel,
        hasClientChannel: !!streamsStore.clientSignalingChannel,
      });
    }
  }

  /**
   * The background gave up on delivering a signal to `peerAddr`.
   *
   * Only 'start' is acted upon: an invitation that never arrived is the one case
   * the window cannot infer on its own, and it is what a peer stuck on "Calling…"
   * with no ringtone at the other end actually means. Other stages are logged and
   * left alone - their own recovery paths (retry watchers, host-silence watchdog)
   * own the consequences.
   */
  async function notifyOfUndeliveredSignal(
    peerAddr: string, stage: WebRTCMsg['stage'],
  ): Promise<void> {
    console.warn(`[VideoChatSrv] '${stage}' to ${peerAddr} was not delivered`);
    log.warn(`'${stage}' to ${peerAddr} was not delivered`);
    if (stage !== 'start') {
      return;
    }
    if (undeliveredInviteHandler) {
      undeliveredInviteHandler(peerAddr);
    } else {
      // Call page not mounted yet: the status alone still beats showing nothing.
      streamsStore.updateRemoteStatus(peerAddr, 'not-reached');
    }
  }

  /**
   * A peer told the background it is re-joining, ahead of its SDP offer.
   *
   * Host-only by construction: only the host's background sends this notice on,
   * and only the host has a channel that can broadcast it further. An
   * unregistered handler is a legitimate race - the notice arrived while the
   * call page was not mounted, or while the window is closing - and nothing is
   * lost by dropping it: the offer follows and announces the return itself,
   * just tens of seconds later, which is exactly the state before this existed.
   */
  async function notifyOfRejoiningPeer(peerAddr: string): Promise<void> {
    console.log(`[VideoChatSrv] ${peerAddr} announced a re-join`);
    log.info(`${peerAddr} announced a re-join`);
    if (rejoiningPeerHandler) {
      rejoiningPeerHandler(peerAddr);
    } else {
      console.warn(`[VideoChatSrv] No handler to announce the re-join of ${peerAddr} to peers`);
      log.warn(`No handler to announce the re-join of ${peerAddr} to peers`);
    }
  }

  /**
   * Our call lost a collision with another one started in this chat at the same
   * moment, and the background has already made this call a client of that
   * one. Here the window follows, without closing.
   *
   * The session goes first: this window drops every signal of a session other
   * than its own, and the winner's answer is on its way.
   */
  async function switchToClientOf(target: RoleSwitchTarget): Promise<void> {
    log.info(
      `Switching to a client of ${target.hostAddr} (session ${target.callSessionId ?? 'n/a'}): `
        + `that call won a collision with ours`,
    );
    if (chat.value) {
      chat.value = {
        ...chat.value,
        direction: 'incoming',
        hostAddr: target.hostAddr,
        callSessionId: target.callSessionId,
      };
    }
    streamsStore.callSessionId = target.callSessionId;
    if (roleSwitchHandler) {
      roleSwitchHandler(target);
    } else if (!streamsStore.starConfig) {
      // No page to say anything yet - the window is still coming up. What the
      // setup screen reads is enough for its button to say "Join".
      streamsStore.pendingDirection = 'incoming';
      streamsStore.pendingHostAddr = target.hostAddr;
    } else {
      log.warn(`No handler to switch the running call to ${target.hostAddr}`);
    }
  }

  function notifyBkgrndInstanceOnCallStart() {
    ctrlObs.value?.next!({ type: 'call-started-event' });
  }

  function watchRequests(obs: web3n.Observer<CallFromVideoGUI>): () => void {
    if (ctrlObs.value) {
      throw `Observer from GUI controller is already set`;
    }

    ctrlObs.value = obs;
    guiRequestSink = req => ctrlObs.value?.next!(req);
    window.addEventListener('beforeunload', () => {
      // Logged BEFORE complete(): deno interprets the completion as "the GUI
      // is done" and ends the call as ended-by-self with no further trace.
      console.warn('[VideoChatSrv] beforeunload — completing GUI observer');
      log.warn('beforeunload — completing GUI observer');
      // Before the channel is closed, and after the line above: completing the
      // observer takes the relay's only way out with it, and what this window
      // logged on its way down is exactly what a lost call needs explaining.
      flushLogRelay?.();
      ctrlObs.value?.complete!();
      guiRequestSink = undefined;
    });

    return () => {
      // The IPC layer's cancel handler: fires when the deno<->window RPC
      // connection is cancelled or dies. Without these lines this was a
      // completely silent teardown — the window vanished, deno logged only
      // "ended-by-self", and nothing pointed at the IPC link (observed
      // 2026-08-11: client window closed itself ~0.5s after Join).
      console.warn('[VideoChatSrv] IPC to background cancelled — completing observer and closing window');
      log.warn('IPC to background cancelled — completing observer and closing window');
      flushLogRelay?.();
      ctrlObs.value?.complete?.();
      guiRequestSink = undefined;
      w3n.closeSelf();
    };
  }

  function passInitialDataToStreamsStore() {
    streamsStore.initialize(
      chat.value!.chatId,
      chat.value!.chatName,
      chat.value!.ownName,
      chat.value!.ownAddr,
      chat.value!.direction,
      chat.value!.hostAddr,
      chat.value!.peers,
      chat.value!.callSessionId,
      chat.value!.rtcConfig,
    );
    // Set participant count for video quality tier selection
    if (chat.value!.participantCount !== undefined) {
      streamsStore.participantCount = chat.value!.participantCount;
    }
  }

  // Watch for starConfig changes to notify background when host starts call.
  // This triggers 'call-started-event' which sends 'stage: start' signal to peers.
  console.log('[VideoChatSrv] Setting up starConfig watcher');
  watch(
    () => streamsStore.starConfig,
    (config, oldConfig) => {
      console.log('[VideoChatSrv] starConfig changed:', {
        oldRole: oldConfig?.role,
        newRole: config?.role,
        hostAddr: config?.hostAddr,
      });
      if (config?.role === 'host') {
        console.log('[VideoChatSrv] Host role detected, notifying background to send start signal');
        notifyBkgrndInstanceOnCallStart();
      }
    },
    { deep: true },
  );

  return {
    endCall,
    focusWindow,
    startVideoCallComponentForChat,
    handleWebRTCSignal,
    notifyOfUndeliveredSignal,
    notifyOfRejoiningPeer,
    switchToClientOf,
    watchRequests,
    notifyBkgrndInstanceOnCallStart,
  };
}
