/*
 Copyright (C) 2026 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but WITHOUT
 ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/
// The "Force-refresh data" action, in one place for both form factors.
//
// The user asks for it when the app has gone quiet: the backend's inbox
// subscription can stop delivering while everything else still answers. The
// backend then replays the shared inbox from the watermark and applies whatever
// it finds (see InboxSrv.forceRefreshData), and the messages reach the screen
// through the ordinary event subscription - this composable only drives the
// action, the loader, the "nothing new" notice and the timeout.
import { inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { NOTIFICATIONS_KEY, type NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import { useAppStore } from '@common/store/app.store';
import { inboxSrv } from '@common/services/services-provider';
import { makeLogger } from '@shared/utils/logger';

const log = makeLogger('ForceRefreshData');

/**
 * How long the user is made to wait before the loader and the blocking are
 * lifted. The call itself cannot be recalled, so this timer does not cancel
 * anything: it only guarantees that a stuck background component cannot leave
 * the window covered with a spinner and refusing every click.
 */
const FORCE_REFRESH_TIMEOUT_MILLIS = 15_000;

export function useForceRefreshData() {
  const { t } = useI18n();
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;
  const appStore = useAppStore();

  async function forceRefreshData(): Promise<void> {
    appStore.setCommonLoading(true);
    const timer = setTimeout(
      () => appStore.setCommonLoading(false),
      FORCE_REFRESH_TIMEOUT_MILLIS,
    );

    try {
      const { applied } = await inboxSrv.forceRefreshData();
      log.info(`Force-refresh of the mailbox: ${applied} new message(s) applied`);
      if (applied === 0) {
        $createNotice({
          type: 'info',
          content: t('app.notification.noNewMessages'),
          duration: 5000,
        });
      }
    } catch (err) {
      log.error(`Force-refresh of the mailbox failed`, err);
    } finally {
      clearTimeout(timer);
      appStore.setCommonLoading(false);
    }
  }

  return { forceRefreshData };
}
