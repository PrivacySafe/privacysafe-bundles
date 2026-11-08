/*
Copyright (C) 2025 3NSoft Inc.

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
import { inject, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { DIALOGS_KEY, DialogsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import { useRouting } from '@main/desktop/composables/useRouting';
import { useContactsStore } from '@main/common/store/contacts.store';
import { useChatStore } from '@main/common/store/chat.store';
import type { ChatIdObj } from '~/asmail-msgs.types';
import ChatCreateDialog from '@main/common/components/dialogs/chat-create-dialog.vue';

export function useChatsView() {
  const { t } = useI18n();
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY)!;

  const { route, goToChatRoute, goToChatsRoute, hasCreateNewChatFlagInRoute } = useRouting();

  const { fetchContacts } = useContactsStore();
  const { resetCurrentChat } = useChatStore();

  async function openCreateChatDialog(isMobileMode?: boolean) {
    const res = await dialog.$openDialog<ChatIdObj>(ChatCreateDialog, {
      dialogProps: {
        title: t('chat.create.dialog.title'),
        width: isMobileMode ? 300 : 360,
        confirmButton: false,
        cancelButton: false,
        closeOnClickOverlay: false,
      },
    });

    const { event, data } = res;
    switch (event) {
      case 'close':
      case 'cancel':
        await closeNewChatDialog();
        break;
      case 'confirm':
        await closeNewChatDialog(data!);
        break;
    }
  }

  async function closeNewChatDialog(chatId?: ChatIdObj) {
    if (chatId) {
      await fetchContacts();
      await goToChatRoute(chatId);
    } else {
      resetCurrentChat();
      await goToChatsRoute();
    }
  }

  async function doBeforeMount() {
    await fetchContacts();
  }

  watch(
    () => route.query,
    val => {
      if (hasCreateNewChatFlagInRoute(val)) {
        openCreateChatDialog();
      }
    },
    { immediate: true },
  );

  return {
    openCreateChatDialog,
    doBeforeMount,
  };
}
