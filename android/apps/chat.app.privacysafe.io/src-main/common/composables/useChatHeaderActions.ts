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
import { computed, type ComputedRef, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useContactsStore } from '@main/common/store/contacts.store';
import { useChatStore } from '@main/common/store/chat.store';
import { chatMenuItems } from '@main/common/constants';
import { toCanonicalAddress } from '@shared/address-utils';
import { ChatListItemView, ChatMenuItem, SingleChatView } from '~/index';

export function useChatHeaderActions(
  props: ComputedRef<{
    chat: ChatListItemView;
    chatWithCall?: boolean;
    disabled?: boolean;
    allOthersBlocked?: boolean;
  }>,
  emits: { (event: 'select:action', value: string): void },
) {
  const { t } = useI18n();

  const contactsStore = useContactsStore();
  const { isBlacklisted } = contactsStore;
  const { currentChat, isAdminOfGroupChat } = storeToRefs(useChatStore());

  const isMenuOpen = ref(false);
  const subMenusState = ref<Record<string, boolean>>({});

  const canLeaveAndDeleteChat = computed(() => {
    if (!currentChat.value?.isGroupChat) {
      return true;
    }

    const { members, admins } = currentChat.value;
    if (!isAdminOfGroupChat.value) {
      return true;
    }

    if (admins.length > 1) {
      return true;
    }

    const acceptedMembersAndNotAdmins = Object.keys(members).reduce((res, addr) => {
      const { hasAccepted } = members[addr];
      if (!admins.includes(addr) && hasAccepted) {
        res.push(addr);
      }

      return res;
    }, [] as string[]);

    return acceptedMembersAndNotAdmins.length === 0;
  });

  const availableMenuItems = computed(() =>
    chatMenuItems
      .filter(i => {
        if (currentChat.value?.isGroupChat) {
          if (i.chatTypes.includes('group')) {
            return true;
          }

          if (isAdminOfGroupChat.value) {
            return i.chatTypes.includes('group&admin');
          }

          return false;
        }

        return i.chatTypes.includes('single');
      })
      .filter(i => {
        if (['contact:block', 'contact:unblock'].includes(i.action)) {
          // Only one of the pair is ever offered, and neither without a peer to
          // be about: the filter above lets these through whenever there is no
          // current chat at all, which is not the same as a one-to-one one.
          const peerAddr = (currentChat.value as SingleChatView | undefined)?.peerAddr;
          if (!peerAddr) {
            return false;
          }

          const isPeerBlacklisted = isBlacklisted(toCanonicalAddress(peerAddr.toLowerCase()));
          return i.action === 'contact:block' ? !isPeerBlacklisted : isPeerBlacklisted;
        }

        return i.action !== 'chat:delete' || (i.action === 'chat:delete' && canLeaveAndDeleteChat.value);
      })
      .map(i => ({
        ...i,
        id: i.action.replaceAll(':', ''),
      })),
  ) as ComputedRef<(ChatMenuItem & { id: string })[]>;

  function selectAction(item: ChatMenuItem) {
    if (item.subMenu) {
      subMenusState.value[item.action] = !subMenusState.value[item.action];
      return;
    }

    isMenuOpen.value = false;

    if (props.value.disabled) {
      return;
    }

    emits('select:action', item.action);
  }

  function isSubItemSelected(subItem: ChatMenuItem): boolean {
    const [, action, value] = subItem.action.split(':');

    if (action === 'timer') {
      const { settings = {} } = props.value.chat;
      const autoDeleteMessages = settings?.autoDeleteMessages || '0';
      return value === autoDeleteMessages;
    }

    return false;
  }

  function isMenuItemDisabled(item: ChatMenuItem): boolean {
    if (props.value.disabled) {
      return true;
    }

    if (props.value.chatWithCall && item.disable?.includes('chat-with-call')) {
      return true;
    }

    // A chat whose every other participant is blocked is shut: there is nobody
    // left to fetch anything from, so force-refresh has nothing to do in it.
    if (props.value.allOthersBlocked && item.disable?.includes('blocked-chat')) {
      return true;
    }

    return false;
  }

  function initialSubMenusState(): Record<string, boolean> {
    return (availableMenuItems.value || []).reduce(
      (res, item) => {
        if (item.subMenu) {
          res[item.action] = false;
        }
        return res;
      },
      {} as Record<string, boolean>,
    );
  }

  subMenusState.value = initialSubMenusState();

  watch(isMenuOpen, (val, oVal) => {
    if (val !== oVal && !val) {
      subMenusState.value = initialSubMenusState();
    }
  });

  watch(
    () => props.value.chatWithCall,
    (val, oVal) => {
      if (val && val !== oVal) {
        isMenuOpen.value = false;
      }
    },
  );

  return {
    t,
    isMenuOpen,
    subMenusState,
    availableMenuItems,
    initialSubMenusState,
    selectAction,
    isSubItemSelected,
    isMenuItemDisabled,
  };
}
