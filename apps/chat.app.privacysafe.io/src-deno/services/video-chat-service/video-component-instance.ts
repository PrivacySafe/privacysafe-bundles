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
import type { CallFromVideoGUI, ChatInfoForCall, VideoChatComponent } from '../../../types/services.types.ts';
import type { VideoComponentInstance, WebRTCSignalListener } from '../../types/index.ts';
import { makeServiceCaller } from '../../../shared-libs/ipc/ipc-service-caller.js';
import { makeLogger } from '../../../shared-libs/logger.ts';

const log = makeLogger('VideoComponentInstance');

/**
 * Methods of the call window this component calls over IPC.
 *
 * makeServiceCaller builds the RPC wrapper from this list alone, so one left
 * out is silently `undefined` at the call site - and the optional-call `?.` on
 * the other side swallows that without a line in any log. The window's own list
 * of what it answers (VIDEO_WINDOW_IPC_METHODS in
 * src-video/common/services/service-provider.ts) has to hold every one of
 * these; a spec compares the two, because the halves drifting apart already
 * left two notifications dead for four days.
 */
export const VIDEO_WINDOW_METHODS_CALLED_HERE: (keyof VideoChatComponent)[] = [
  'startVideoCallComponentForChat',
  'focusWindow',
  'endCall',
  'handleWebRTCSignal',
  'notifyOfUndeliveredSignal',
  'notifyOfRejoiningPeer',
  'switchToClientOf',
];

export async function videoComponentInstance(
  chat: ChatInfoForCall,
  obs: web3n.Observer<CallFromVideoGUI>,
): Promise<{ instance: VideoComponentInstance; startProc: Promise<void> }> {
  // Timed, because opening the window is what the user waits through after
  // pressing Call, and nothing used to say how long it took or which half of
  // it was slow: the platform bringing the window up, or the window's own
  // start-up answering us. Without these two numbers the only available
  // answer to "the window opens with a pause" was a guess (2026-09-11).
  const askedAt = Date.now();
  const srvConn = await w3n.rpc!.thisApp!('VideoChatComponent');
  log.info(`call window answered the platform in ${Date.now() - askedAt}ms`);
  const guiSrv = makeServiceCaller<VideoChatComponent>(
    srvConn,
    VIDEO_WINDOW_METHODS_CALLED_HERE,
    ['watchRequests'],
  ) as VideoChatComponent;

  async function focusWindow(): Promise<void> {
    await guiSrv.focusWindow();
  }

  async function endCall(): Promise<void> {
    await guiSrv.endCall();
  }

  function getListenerForChannelTo(peer: string): WebRTCSignalListener {
    return msg => {
      guiSrv.handleWebRTCSignal(peer, msg).catch(err => {
        log.warn(`Failed to forward WebRTC signal to GUI for peer ${peer}`, err);
      });
    };
  }

  /**
   * Drops the RPC connection to the call window.
   *
   * Nothing used to: one connection leaked per call, and - worse than the
   * leak - the caller kept a usable-looking handle to a window that had
   * closed, on which focusWindow() either throws or never returns (see the
   * end of end() in utils/call.ts).
   */
  function close(): void {
    srvConn.close?.();
  }

  const instance: VideoComponentInstance = {
    focusWindow,
    endCall,
    close,
    getListenerForChannelTo,
    notifyOfUndeliveredSignal: (peer, stage) => guiSrv.notifyOfUndeliveredSignal(peer, stage),
    notifyOfRejoiningPeer: peer => guiSrv.notifyOfRejoiningPeer(peer),
    switchToClientOf: target => guiSrv.switchToClientOf(target),
  };

  guiSrv.watchRequests(obs);

  const startProc = guiSrv.startVideoCallComponentForChat(chat).then(() => {
    log.info(`call window ready ${Date.now() - askedAt}ms after it was asked for`);
  });

  return {
    instance,
    startProc,
  };
}
