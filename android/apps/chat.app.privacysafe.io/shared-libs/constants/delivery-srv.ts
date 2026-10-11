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

export const DELIVERY_SERVICE_DATA_FILE_NAME = 'delivery-service-data.json';

/**
 * Pause between two sync phantoms handed to delivery in one pass over the
 * journal - the same spacing as SIGNAL_SEND_SPACING_MS in webrtc-signalling.ts,
 * and for the same reason.
 *
 * A pass releases everything the journal holds, and a device started after a
 * pause holds a change per action made meanwhile: without spacing that is
 * dozens of deliveries begun at once, which is the profile measured to make the
 * server answer 500 to the whole burst. It applies *between* messages only, so
 * the ordinary path - one change, one phantom, gone immediately - is unchanged.
 */
export const PHANTOM_SEND_SPACING_MS = 200;

/**
 * How long a sync phantom handed to delivery may wait for an outcome before its
 * journal row is released again (see phantom-flight.ts).
 *
 * Set above the reconcile sweep's window on purpose: that sweep cancels a
 * delivery without progress at STUCK_MSG_MS = 5 min and runs every 60 s, so it
 * normally hands the row back first, and the two mechanisms never both act on
 * one row. Being wrong either way costs one duplicate phantom, which the
 * receiving device drops on an equal ordering token.
 */
export const PHANTOM_FLIGHT_GRACE_MS = 7 * 60_000;
