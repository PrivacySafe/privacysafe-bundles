/*
 Copyright (C) 2026 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but WITHOUT
 ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 FOR A PARTICULAR PURPOSE.  See the GNU General Public License for more
 details.

 You should have received a copy of the GNU General Public License along with
 this program.  If not, see <http://www.gnu.org/licenses/>.
*/
// The "Force-refresh chat" action, in one place for both form factors.
//
// The user asks for it when the app has gone quiet: the core's inbox
// subscription can stop delivering while everything else still answers. The
// backend then lists the shared inbox for this chat and applies whatever it
// finds (see ChatSrv.forceRefreshChat), and the messages reach the screen
// through the ordinary event subscription - this composable only drives the
// action, the loader and the timeout.
import { inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { NOTIFICATIONS_KEY, type NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import { useAppStore } from '@main/common/store/app.store';
import { useChatStore } from '@main/common/store/chat.store';
import { chatService } from '@main/common/services/external-services';
import { callBackend, isBackendUnreachable } from '@main/common/services/backend-availability';
import { makeLogger } from '@shared/logger';

const log = makeLogger('ForceRefreshChat');

/**
 * How long the user is made to wait before the loader and the blocking are
 * lifted. The call itself cannot be recalled, so this timer does not cancel
 * anything: it only guarantees that a stuck background component cannot leave
 * the window covered with a spinner and refusing every click.
 */
const FORCE_REFRESH_TIMEOUT_MILLIS = 10_000;

export function useForceRefreshChat() {
  const { t } = useI18n();
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;
  const appStore = useAppStore();
  const chatStore = useChatStore();

  async function forceRefreshChat(): Promise<void> {
    const chatId = chatStore.currentChatId;
    if (!chatId) {
      // The menu item is disabled outside a chat, so this is a guard rather
      // than a path the user can reach.
      log.error(`Force-refresh requested without a current chat`);
      return;
    }

    appStore.setCommonLoading(true);
    const timer = setTimeout(
      () => appStore.setCommonLoading(false),
      FORCE_REFRESH_TIMEOUT_MILLIS,
    );

    try {
      const res = await callBackend(
        'forceRefreshChat',
        () => chatService.forceRefreshChat(chatId),
      );
      log.info(
        `Force-refresh of chat ${chatId.chatId}: ${res.listed} listed, `
          + `${res.applied} applied`,
      );
      if (res.applied === 0) {
        $createNotice({ type: 'info', content: t('chat.notification.noNewMessages'), duration: 5000 });
      }
    } catch (err) {
      log.error(`Force-refresh of the current chat failed`, err);
      if (isBackendUnreachable(err)) { appStore.backendState = 'unreachable'; }
    } finally {
      clearTimeout(timer);
      appStore.setCommonLoading(false);
    }
  }

  return { forceRefreshChat };
}
