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
import type { LocalMetadataInDelivery } from '../../../types/chat.types.ts';
import type { ChatSrv, DB } from '../../types/index.ts';
import {
  handleRegularSendingProgress,
  handleInvitationSendingProgress,
  handleSystemSendingProgress,
  handleSyncSendingProgress,
} from '../mail-sending-service/index.ts';
import { removeMsgFromDelivery } from '../chat-service/utils/_msgs-related-methods.ts';
import { noteSignalDeliveryOutcome } from '../../../shared-libs/webrtc-signalling.ts';
import { noteHeartbeatDeliveryOutcome } from '../video-chat-service/utils/heartbeat-delivery.ts';
import { makeLogger } from '../../../shared-libs/logger.ts';

const log = makeLogger('DeliveryMonitor');

/**
 * Delivery Monitor
 * 
 * Responsible for:
 * - Subscribing to delivery progress events
 * - Dispatching progress to appropriate handlers based on message type
 * - Tracking message delivery status
 */
/**
 * How long a completed webrtc-signal delivery record lingers before rmMsg.
 *
 * Removing it the instant `allDone` arrives races the sender's own
 * confirmation subscription: this monitor's observeAllDeliveries event fires
 * BEFORE per-delivery observers get theirs, so an immediate rmMsg could
 * erase the record between the sender's addMsg() and its observeDelivery()
 * - which then reports `msgNotFound` instead of success. The grace window
 * lets any late subscriber see the terminal state first; signalling records
 * are tiny, so holding them briefly costs nothing.
 */
const WEBRTC_RM_DELAY_MS = 20_000;

export async function deliveryMonitor({
  ownAddr,
  appDeviceId,
  db,
  chatsSrv,
  nextSyncStamp,
}: {
  ownAddr: string;
  appDeviceId: string;
  db: DB;
  chatsSrv: ChatSrv;
  nextSyncStamp: () => Promise<number>;
}): Promise<{ stop: () => void }> {
  const scheduledWebrtcCleanups = new Map<string, ReturnType<typeof setTimeout>>();

  const stopDeliveryWatch = w3n.mail!.delivery.observeAllDeliveries({
    next: async data => {
      try {
        const { id, progress } = data;
        if (
          !progress?.localMeta ||
          typeof progress.localMeta !== 'object' ||
          !(progress.localMeta as LocalMetadataInDelivery).chatId
        ) {
          log.error(`There is no local metadata for the message ${id} being sent.`);
          return;
        }

        const { chatMessageType } = progress.localMeta as LocalMetadataInDelivery;

        switch (chatMessageType) {
          case 'regular': {
            await handleRegularSendingProgress({
              ownAddr,
              sourceDeviceId: appDeviceId,
              data,
              db,
              emitEventsOutward: chatsSrv.emitEventsOutward,
              nextSyncStamp,
            });
            break;
          }

          case 'invitation': {
            await handleInvitationSendingProgress({ data });
            break;
          }

          case 'system': {
            await handleSystemSendingProgress({ data });
            break;
          }

          case 'synchronization': {
            await handleSyncSendingProgress({ data, db, ownAddr });
            break;
          }

          case 'webrtc-call': {
            if (progress.allDone) {
              // Hands the outcome back to whoever sent this signal. Until this
              // existed, a failed signal delivery was noticed HERE and nowhere
              // else: the senders are fire-and-forget (see
              // CONFIRM_DELIVERY_ENABLED), so a lost 'start' left the invited peer
              // silent while the host's log claimed the invitation went out
              // (2026-08-12). Only signals sent from this process are registered
              // there; the rest fall through to the logging below unchanged.
              noteSignalDeliveryOutcome(id, progress);
              // Heartbeats are not sent through sendWebRTCSignal (one delivery,
              // many recipients), so they have their own registry — see
              // video-chat-service/utils/heartbeat-delivery.ts.
              noteHeartbeatDeliveryOutcome(id, progress);
            }
            if (progress.allDone === 'with-errors') {
              // A failed signal delivery is otherwise invisible: the senders are
              // fire-and-forget (see CONFIRM_DELIVERY_ENABLED). Per-recipient
              // error details are the only trace of WHY a burst of signals
              // failed (observed at call teardown, 2026-08-10).
              const errs = Object.entries(progress.recipients ?? {})
                .filter(([, r]) => r.err)
                .map(([addr, r]) => `${addr}: ${JSON.stringify(r.err)}`)
                .join('; ');
              log.warn(`Signal delivery ${id} finished with-errors: ${errs || 'no per-recipient error recorded'}`);
            } else {
              log.debug(`Signal delivery ${id} progress: allDone=${progress.allDone ?? 'not-yet'}`);
            }
            // WebRTC signals are transient — remove from delivery after sending
            // completes, with a grace delay (see WEBRTC_RM_DELAY_MS).
            if (progress.allDone && !scheduledWebrtcCleanups.has(id)) {
              scheduledWebrtcCleanups.set(id, setTimeout(() => {
                scheduledWebrtcCleanups.delete(id);
                removeMsgFromDelivery(id).catch(err => {
                  log.warn(`Failed to remove WebRTC message ${id} from delivery`, err);
                });
              }, WEBRTC_RM_DELAY_MS));
            }
            break;
          }
        }
      } catch (err) {
        log.error(`Unhandled error processing delivery progress for message ${data?.id}:`, err);
        w3n.log('error', `Unhandled error processing delivery progress for message ${data?.id}`, err).catch(() => {});
      }
    },
    error: err => {
      w3n.log('error', 'Error tracking the messages sending process. ', err);
    },
  });

  return {
    stop: () => {
      stopDeliveryWatch();
      for (const timer of scheduledWebrtcCleanups.values()) {
        clearTimeout(timer);
      }
      scheduledWebrtcCleanups.clear();
    },
  };
}