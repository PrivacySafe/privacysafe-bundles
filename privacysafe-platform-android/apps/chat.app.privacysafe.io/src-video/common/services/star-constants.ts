/*
  Copyright (C) 2026 3NSoft Inc.

  This program is free software: you can redistribute it and/or modify it under
  the terms of the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful, but
  WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
  See the GNU General Public License for more details.

  You should have received a copy of the GNU General Public License along with
  this program. If not, see <http://www.gnu.org/licenses/>.
*/

/**
 * Star (Host-Client) Architecture Constants for Frontend
 *
 * Re-exports from shared-libs to ensure the frontend and Deno backend use
 * the exact same values. Previously these were duplicated and desynchronized
 * (Deno had MAX_CALL_PARTICIPANTS=10, frontend had =8).
 */

export {
  MAX_CALL_PARTICIPANTS,
  getVideoQualityConfig,
  SCREEN_SHARE_QUALITY,
  SIMULCAST_ENCODINGS,
  getSimulcastLayerFor,
  buildMediaConstraints,
} from '@shared/constants/video-call';

export type { VideoQualityConfig } from '@shared/constants/video-call';
