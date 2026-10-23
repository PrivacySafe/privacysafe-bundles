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
import { computed, inject, onBeforeMount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';
import { NOTIFICATIONS_KEY, NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import type { Nullable, Ui3nDialogEvent } from '@v1nt1248/3nclient-lib';
import { includesAddress, toCanonicalAddress } from '@shared/address-utils';
import { AUTO_DELETE_MESSAGES_BY_ID } from '@shared/constants';
import type { GroupChatView, PersonView } from '~/index';
import type { ChatInfoDialogProps } from './types';
import { useAppStore } from '@main/common/store/app.store';
import { useContactsStore } from '@main/common/store/contacts.store';
import { useChatStore } from '@main/common/store/chat.store';

export function useChatInfo(
  props: ChatInfoDialogProps,
  emits: { (event: 'action', value: { event: Ui3nDialogEvent }): void },
) {
  const { t } = useI18n();
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;
  const { user: ownAddr } = storeToRefs(useAppStore());

  const contactsStore = useContactsStore();
  const { contactList } = storeToRefs(contactsStore);
  const { fetchContacts } = contactsStore;

  const { updateGroupMembers, updateGroupAdmins } = useChatStore();

  const editMembersMode = ref(false);
  const memberSearch = ref('');
  const userSearch = ref('');
  const initialSelectedUsers = ref<(PersonView & { displayName: string })[]>([]);
  const selectedUsers = ref<(PersonView & { displayName: string })[]>([]);
  const listItemMenuProps = ref<{
    open: boolean;
    canClose: boolean;
    listItem: Nullable<{ contactId: string; mail: string; isAdmin: boolean }>;
    listItemElId: Nullable<string>;
  }>({
    open: false,
    canClose: false,
    listItem: null,
    listItemElId: null,
  });

  const chatCanonicalMembers = computed(() => {
    if (!props.chat.isGroupChat) {
      return {};
    }

    return Object.keys(props.chat.members || {}).reduce(
      (res, addr) => {
        const canonicalAddr = toCanonicalAddress(addr);
        res[canonicalAddr] = cloneDeep((props.chat as GroupChatView).members[addr]);
        return res;
      },
      {} as Record<string, { hasAccepted: boolean }>,
    );
  });

  const dialogWidth = computed(() => (props.isMobileMode ? '300px' : '380px'));

  const autoDeleteMessageInfo = computed(() => {
    const { settings } = props.chat;
    const autoDeleteMessagesSettingId = (settings?.autoDeleteMessages || '0') as '0' | '1' | '2' | '3' | '4' | '5';
    return AUTO_DELETE_MESSAGES_BY_ID[autoDeleteMessagesSettingId];
  });

  const allContacts = computed(() => {
    const value = cloneDeep(contactList.value);
    if (props.chat.isGroupChat) {
      for (const addr of Object.keys(chatCanonicalMembers.value)) {
        const isThereUser = value.find(c => toCanonicalAddress(c.mail) === addr);

        if (!isThereUser) {
          value.push({
            id: addr,
            mail: addr,
            displayName: addr,
          });
        }
      }
    } else {
      const addr = toCanonicalAddress(props.chat.peerAddr);
      const isThereUser = value.find(c => toCanonicalAddress(c.mail) === addr);
      if (!isThereUser) {
        value.push({
          id: addr,
          mail: addr,
          displayName: addr,
        });
      }
    }

    return value;
  });

  const members = computed<(PersonView & { displayName: string })[]>(() => {
    const addrsInChat = props.chat.isGroupChat
      ? Object.keys(props.chat.members).map(m => toCanonicalAddress(m))
      : [ownAddr.value, toCanonicalAddress(props.chat.peerAddr)];

    return allContacts.value.filter(c => includesAddress(addrsInChat, toCanonicalAddress(c.mail)));
  });

  const filteredMembers = computed(() =>
    members.value.filter(m => m.displayName.toLowerCase().includes(memberSearch.value.toLowerCase())),
  );

  const nonDeletableUsers = computed(() => {
    const me = contactList.value.find(c => toCanonicalAddress(c.mail) === ownAddr.value);
    return me
      ? [
          {
            ...me,
            displayName: 'Me',
          },
        ]
      : [];
  });

  const addBtnDisable = computed(() =>
    isEqual(initialSelectedUsers.value.slice().sort(), selectedUsers.value.slice().sort()),
  );

  function isUserAdmin(addr: string): boolean {
    if (props.chat.isGroupChat) {
      return includesAddress(props.chat.admins, addr);
    }

    return addr === ownAddr.value;
  }

  function isUserPending(addr: string): boolean {
    if (props.chat.isGroupChat) {
      return !chatCanonicalMembers.value[toCanonicalAddress(addr)]?.hasAccepted;
    }

    return toCanonicalAddress(addr) !== ownAddr.value && props.chat.status !== 'on';
  }

  function closeDialog() {
    emits('action', { event: 'close' });
  }

  async function openEditMode() {
    await fetchContacts();
    editMembersMode.value = true;
    userSearch.value = memberSearch.value;
    selectedUsers.value = cloneDeep(members.value);
    initialSelectedUsers.value = cloneDeep(selectedUsers.value);
  }

  function back() {
    editMembersMode.value = false;
    userSearch.value = '';
  }

  function isContactSelected(contact: PersonView & { displayName: string }): boolean {
    const userIndex = selectedUsers.value.findIndex(u => u.mail === contact.mail);
    return userIndex !== -1;
  }

  function selectUsers(user: PersonView & { displayName: string }) {
    const userIndex = selectedUsers.value.findIndex(u => u.mail === user.mail);
    if (userIndex === -1) {
      selectedUsers.value.push(user);
    } else {
      selectedUsers.value.splice(userIndex, 1);
    }
  }

  function updateMembers() {
    const { members } = props.chat as GroupChatView;
    const updatedMembers = allContacts.value.reduce(
      (res, c) => {
        const { mail } = c;
        if (isContactSelected(c)) {
          res[mail] = {
            hasAccepted: members[mail] ? members[mail].hasAccepted : false,
          };
        }
        return res;
      },
      {} as Record<string, { hasAccepted: boolean }>,
    );

    updateGroupMembers(props.chat.chatId, updatedMembers).then(canClose => {
      canClose && closeDialog();
    });
  }

  function openListItemMenu({ contactId, mail }: { contactId: string; mail: string }) {
    if (!props.chat.isGroupChat) {
      return;
    }

    if (!isUserAdmin(ownAddr.value)) {
      return;
    }

    if (props.chat.isGroupChat && !props.chat.members[mail].hasAccepted) {
      return;
    }

    if (props.chat.isGroupChat && mail === ownAddr.value && props.chat.admins.length === 1) {
      return;
    }

    const listItemMailParts = mail.split('@');
    const listItemElId = listItemMailParts && listItemMailParts[0] ? `item-${listItemMailParts[0]}` : null;
    listItemMenuProps.value.listItem = {
      contactId,
      mail,
      isAdmin: isUserAdmin(mail),
    };
    listItemMenuProps.value.listItemElId = listItemElId;
    listItemMenuProps.value.open = true;

    setTimeout(() => {
      listItemMenuProps.value.canClose = true;
    }, 500);
  }

  function closeListItemMenu() {
    if (!listItemMenuProps.value.canClose) {
      return;
    }

    listItemMenuProps.value = {
      open: false,
      canClose: false,
      listItem: null,
      listItemElId: null,
    };
  }

  function handleAction({
    action,
    user,
  }: {
    action: 'make:admin' | 'remove:admin';
    user: { contactId: string; mail: string };
  }) {
    if (!props.chat.isGroupChat) {
      return;
    }

    const updatedAdmins = cloneDeep(props.chat.admins);
    const ind = updatedAdmins.indexOf(user.mail);

    switch (action) {
      case 'make:admin':
        if (ind > -1) {
          $createNotice({
            type: 'error',
            content: t('chat.app_message.error.already_admin', { user: user.mail }),
          });
          return;
        }
        updatedAdmins.push(user.mail);
        break;
      case 'remove:admin':
        if (ind === -1) {
          $createNotice({
            type: 'error',
            content: t('chat.app_message.error.already_not_admin', { user: user.mail }),
          });
          return;
        }

        if (updatedAdmins.length === 1) {
          $createNotice({
            type: 'error',
            content: t('chat.app_message.error.only_admin', { user: user.mail }),
          });
          return;
        }

        updatedAdmins.splice(ind, 1);
        break;
      default:
        break;
    }

    updateGroupAdmins(props.chat.chatId, updatedAdmins);
    closeDialog();
  }

  onBeforeMount(async () => {
    await fetchContacts();
  });

  return {
    ownAddr,
    nonDeletableUsers,
    dialogWidth,
    userSearch,
    memberSearch,
    editMembersMode,
    listItemMenuProps,
    autoDeleteMessageInfo,
    members,
    filteredMembers,
    allContacts,
    addBtnDisable,
    selectedUsers,
    isUserAdmin,
    isUserPending,
    openEditMode,
    selectUsers,
    openListItemMenu,
    closeListItemMenu,
    back,
    updateMembers,
    handleAction,
    closeDialog,
  };
}
