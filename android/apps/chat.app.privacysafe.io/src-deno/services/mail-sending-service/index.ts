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
 * Mail Sending Service
 *
 * This module provides functions for sending chat messages and handling delivery progress.
 *
 * ## Sending Primitives
 * Low-level functions for adding messages to the delivery queue:
 * - `addMessageToDeliveryList` - Add any message to delivery
 * - `sendSystemMessage` - Send a system message
 * - `sendSystemDeletableMessage` - Send a deletable system message
 * - `sendChatInvitation` - Send a chat invitation
 * - `sendRegularMessage` - Send a regular chat message
 * - `sendSysMsgsAboutRemovalFromChat` - Notify about member removal
 * - `sendSysMsgToLeaveChat` - Notify about leaving a chat
 *
 * ## Sync Phantoms
 * Messages a device sends to itself, so that the user's other devices learn
 * about a change made here. A phantom is built by a `make*Phantom` function,
 * journalled together with the change's ordering tokens by `queueSyncPhantom`,
 * and handed to delivery by `releasePendingSyncPhantoms` - see
 * sync-phantoms.ts for why the last two are separate steps.
 *
 * ## Progress Handlers
 * Functions for handling delivery progress events:
 * - `handleRegularSendingProgress` - Handle regular message delivery
 * - `handleInvitationSendingProgress` - Handle invitation delivery
 * - `handleSystemSendingProgress` - Handle system message delivery
 * - `handleSyncSendingProgress` - Handle sync message delivery
 */

// Sending primitives
export {
  addMessageToDeliveryList,
  newSyncPhantomDeliveryId,
  sendSystemMessage,
  sendSystemDeletableMessage,
  sendChatInvitation,
  sendSysMsgsAboutRemovalFromChat,
  sendSysMsgToLeaveChat,
  sendRegularMessage,
} from './sending-primitives.ts';

// Sync phantoms
export {
  makeSystemEventPhantom,
  makeMsgRecordPhantom,
  makeDeleteMessagePhantom,
  makeMsgStatusPhantom,
  makeMemberRemovedPhantom,
  makeInvitationPhantom,
  makeInvitationAcceptedPhantom,
  queueSyncPhantom,
  queueSnapshotChunks,
  releasePendingSyncPhantoms,
  planJournalRelease,
  setPhantomReleaseBusyCheck,
  setSyncPassOutcomeSink,
  setSyncDeliveryOutcomeSink,
  notePhantomDeliveryOutcome,
  scheduleSyncPhantomRetryAfterFailure,
  countPhantomsAwaitingRelease,
  countSyncPhantomsInDelivery,
} from './sync-phantoms.ts';
export type { SyncPhantom, SyncPhantomReleaseResult } from './sync-phantoms.ts';

// Flight registry of phantoms handed to delivery (see phantom-flight.ts)
export {
  countFlights,
  countFlightsAwaitingOutcome,
  clearAllFlights,
  currentFlights,
  describeDeliveryErrors,
  describeJournalRow,
  flightsToForget,
  forgetFlightOfRow,
  isFlightAbandoned,
  isTerminalDeliveryFailure,
  notePhantomHandedToDelivery,
  partitionByFlight,
  takeFlightOfDelivery,
} from './phantom-flight.ts';
export type { PhantomFlight } from './phantom-flight.ts';

// Progress handlers
export { handleRegularSendingProgress } from './progress-handlers/handle-regular-sending-progress.ts';
export { handleInvitationSendingProgress } from './progress-handlers/handle-invitation-sending-progress.ts';
export { handleSystemSendingProgress } from './progress-handlers/handle-system-sending-progress.ts';
export { handleSyncSendingProgress } from './progress-handlers/handle-sync-sending-progress.ts';
