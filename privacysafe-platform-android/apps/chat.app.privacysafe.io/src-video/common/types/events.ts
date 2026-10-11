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
import type { StreamType } from '@video/common/types/peer.types';

export interface PeerEvents {
  'peer:connecting': PeerEvent;
  'peer:connected': PeerEvent;
  'peer:disconnected': PeerEvent;
  'peer:info-msg': PeerEvent & { msg: unknown };
  'stream:added': PeerStreamEvent & { streamType: StreamType };
  'stream:removed': PeerStreamEvent;
  'stream:track-event': PeerStreamEvent & {
    audio: boolean;
    video: boolean;
  };
}

export interface PeerEvent {
  peerAddr: string;
}

export interface PeerStreamEvent extends PeerEvent {
  streamId: string;
}
