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
import { LOGO_ICON_AS_ARRAY } from '../../../../src/common/constants/files.ts';
import { makeLogger } from '../../../../shared/utils/logger.ts';

type NotificationOpts = web3n.shell.notifications.NotificationOpts;

const log = makeLogger('InboxNotify');

let lastNotificationId: number | undefined;
let queue: Promise<void> = Promise.resolve();

/**
 * Shows an OS notification in place of the previous one, so that the app keeps
 * at most one notification in the OS notification center instead of piling
 * them up.
 *
 * Calls are serialized: two notifications coming almost at once would
 * otherwise both remove the same previous one, and one of them would stay.
 *
 * The id of the shown notification lives in memory only, so after a restart of
 * the background component the notification shown before it stays in place.
 */
export function replaceSystemNotification(opts: NotificationOpts): Promise<void> {
  const step = queue.then(async () => {
    const userNotifications = w3n.shell?.userNotifications;
    if (!userNotifications) {
      return;
    }

    if (lastNotificationId !== undefined) {
      const prevId = lastNotificationId;
      lastNotificationId = undefined;
      try {
        await userNotifications.removeNotification(prevId);
      } catch (err) {
        // The user may have already dismissed or clicked it - nothing to remove.
        log.warn(`Failed to remove OS notification ${prevId}`, err);
      }
    }

    lastNotificationId = await userNotifications.addNotification(opts);
  });
  queue = step.catch(() => {});
  return step;
}

export async function notifyNewIncomingMail(sender: string, subject: string, msgId: string): Promise<void> {
  try {
    await replaceSystemNotification({
      icon: Uint8Array.from(LOGO_ICON_AS_ARRAY),
      title: sender,
      body: (subject || '').slice(0, 50),
      cmd: { cmd: 'open-inbox-msg', params: [{ msgId }] },
    });
  } catch (err) {
    log.error(`Failed to show OS notification for message ${msgId}`, err);
  }
}
