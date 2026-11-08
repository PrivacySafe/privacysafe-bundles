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
import { useVideoChatSrv } from './video-chat-service/video-chat-srv';
import type { VideoChatComponent } from '~/index';
import { MultiConnectionIPCWrap } from '@shared/ipc/ipc-service';

export let videoChatSrv: VideoChatComponent;

/**
 * What this window answers to over IPC.
 *
 * Must hold every method the background calls on it - see the matching list in
 * src-deno/services/video-chat-service/video-component-instance.ts, and the
 * spec that compares the two. It is one list too easy to forget:
 * `notifyOfUndeliveredSignal` and `notifyOfRejoiningPeer` were implemented here,
 * named there, and left out of this one, so both were dead from the day they
 * were written - the background's calls came back as "Method … not found", and
 * the live run of 2026-08-16 was the first thing to notice.
 *
 * `notifyBkgrndInstanceOnCallStart` is deliberately absent: it is this window
 * calling the background, not the other way round.
 */
export const VIDEO_WINDOW_IPC_METHODS: (keyof VideoChatComponent)[] = [
  'startVideoCallComponentForChat',
  'focusWindow',
  'endCall',
  'handleWebRTCSignal',
  'notifyOfUndeliveredSignal',
  'notifyOfRejoiningPeer',
  'switchToClientOf',
];

export async function initializationServices() {
  videoChatSrv = useVideoChatSrv();
  const srvWrap = new MultiConnectionIPCWrap('VideoChatComponent');
  srvWrap.exposeReqReplyMethods(videoChatSrv, VIDEO_WINDOW_IPC_METHODS);
  srvWrap.exposeObservableMethods(videoChatSrv, [
    'watchRequests'
  ]);
  srvWrap.startIPC();
}
