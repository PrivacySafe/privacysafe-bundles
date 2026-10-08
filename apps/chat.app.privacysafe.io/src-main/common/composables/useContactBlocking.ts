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

import { inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import {
  DIALOGS_KEY,
  DialogsPlugin,
  NOTIFICATIONS_KEY,
  NotificationsPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import { useAppStore } from '@main/common/store/app.store';
import { useContactsStore } from '@main/common/store/contacts.store';
import ConfirmationDialog from '@main/common/components/dialogs/confirmation-dialog.vue';
import { makeLogger } from '@shared/logger';

const log = makeLogger('ContactBlocking');

/**
 * Asking the user, and then blocking or unblocking - in one place, because it
 * is reached from two: the chat menu, and the Unblock button on the system
 * record that the blocking itself left in the chat.
 */
export function useContactBlocking() {
  const { t } = useI18n();
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const notification = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const { isMobileMode } = storeToRefs(useAppStore());
  const { isBlacklisted, setContactBlocking } = useContactsStore();

  /**
   * Confirms with the user, then blocks (`value: true`) or unblocks the address.
   *
   * A no-op when the address is already in the asked-for state: the menu item
   * and the button are both rendered off a list that an event from another app
   * can change under them.
   */
  async function runContactBlocking(mail: string, value: boolean): Promise<void> {
    if (isBlacklisted(mail) === value) {
      return;
    }

    const res = await dialog.$openDialog<boolean>(ConfirmationDialog, {
      dialogText: value
        ? t('dialog.text.block', { mail: `<b>${mail}</b>` })
        : t('dialog.text.unblock', { mail: `<b>${mail}</b>` }),
      additionalDialogText: value ? t('dialog.additionalText.block') : t('dialog.additionalText.unblock'),
      dialogProps: {
        icon: { icon: 'round-warning', color: 'var(--color-icon-control-warning-default)' },
        title: t('dialog.label.warning'),
        width: isMobileMode.value ? 300 : 480,
        confirmButtonBackground: value ? 'var(--warning-content-default)' : 'var(--color-bg-button-primary-default)',
        confirmButtonText: value ? t('dialog.button.block') : t('dialog.button.unblock'),
        cancelButtonText: t('dialog.button.default.cancel'),
      },
    });

    if (res.event !== 'confirm') {
      return;
    }

    try {
      await setContactBlocking(mail, value);
    } catch (err) {
      log.error(`Failed to ${value ? 'block' : 'unblock'} ${mail}.`, err);
      notification.$createNotice({
        type: 'error',
        content: value ? t('chat.contact.error.block') : t('chat.contact.error.unblock'),
      });
    }
  }

  return { runContactBlocking };
}
