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

import { makeLogger } from '../../shared-libs/logger.ts';

type NotificationOpts = web3n.shell.notifications.NotificationOpts;
type UserNotifications = web3n.shell.notifications.UserNotifications;

const log = makeLogger('SysNotifications');

let lastNotificationId: number | undefined;
let queue: Promise<void> = Promise.resolve();
let isWatching = false;

/**
 * Logs what the platform reports about our notifications. Diagnostics only:
 * it tells whether the ids we get are the ones the platform then shows, and
 * whether a removal ever results in 'closed'.
 */
function watchPlatformEvents(userNotifications: UserNotifications): void {
  if (isWatching) {
    return;
  }
  isWatching = true;
  try {
    userNotifications.watch({
      next: ev => log.info(`platform event '${ev.type}' for notification ${ev.notificationId}`),
      error: err => log.error('platform notification events failed', err),
      complete: () => log.info('platform notification events completed'),
    });
  } catch (err) {
    log.error('cannot watch platform notification events', err);
  }
}

/**
 * Shows an OS notification in place of the previous one, so that the app keeps
 * at most one notification in the OS notification center instead of piling
 * them up.
 *
 * Calls are serialized: two notifications coming almost at once would
 * otherwise both remove the same previous one, and one of them would stay.
 */
export function replaceSystemNotification(opts: NotificationOpts): Promise<void> {
  const step = queue.then(async () => {
    const userNotifications = w3n.shell?.userNotifications;
    if (!userNotifications) {
      log.info('no userNotifications capability, notification is not shown');
      return;
    }
    watchPlatformEvents(userNotifications);

    if (lastNotificationId !== undefined) {
      const prevId = lastNotificationId;
      lastNotificationId = undefined;
      log.info(`removing notification ${prevId}`);
      try {
        const res = await userNotifications.removeNotification(prevId);
        log.info(`removeNotification(${prevId}) resolved with ${JSON.stringify(res)}`);
      } catch (err) {
        // The user may have already dismissed or clicked it - nothing to remove.
        log.warn(`removeNotification(${prevId}) failed`, err);
      }
    }

    try {
      const id = await userNotifications.addNotification(opts);
      log.info(`addNotification '${opts.title}' resolved with id ${JSON.stringify(id)} (${typeof id})`);
      lastNotificationId = id;
    } catch (err) {
      log.error(`addNotification '${opts.title}' failed`, err);
      throw err;
    }
  });
  queue = step.catch(() => {});
  return step;
}
