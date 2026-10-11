/*
Copyright (C) 2024 - 2025 3NSoft Inc.

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
 * Stream toggle utilities — used for enabling/disabling audio/video tracks.
 * 
 * Note: makePeerState() has been removed as it was part of Mesh architecture.
 * Peer state management will be reimplemented for Star architecture.
 */

export function toggleAudioIn(stream: MediaStream, enable: boolean): void {
  stream.getAudioTracks().forEach(audioTrack => {
    audioTrack.enabled = enable;
  });
}

export function toggleVideoIn(stream: MediaStream, enable: boolean): void {
  stream.getVideoTracks().forEach(videoTrack => {
    videoTrack.enabled = enable;
  });
}