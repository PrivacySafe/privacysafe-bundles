<!--
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
-->
<script lang="ts" setup>
  import { useI18n } from 'vue-i18n';
  import {
    Ui3nButton,
    Ui3nChip,
    Ui3nDialog,
    type Ui3nDialogEvent,
    Ui3nIcon,
    Ui3nInput,
  } from '@v1nt1248/3nclient-lib';
  import { capitalize } from '@v1nt1248/3nclient-lib/utils';
  import { getChatName } from '@main/common/utils/chat-ui.helper';
  import type { ChatInfoDialogProps } from './types';
  import { useChatInfo } from './useChatInfo';
  import { AUTODELETE_OFF } from '@shared/constants';
  import ChatAvatar from '@main/common/components/chat/chat-avatar.vue';
  import ContactList from '@main/common/components/contacts/contact-list.vue';
  import ListItemMenu from './list-item-menu.vue';

  const props = defineProps<ChatInfoDialogProps>();
  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent }): void;
  }>();

  const { t } = useI18n();

  const {
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
  } = useChatInfo(props, emits);
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    :class="$style.chatInfoDialog"
    @action="emits('action', $event)"
  >
    <template #body>
      <div :class="$style.chatInfoDialogBody">
        <template v-if="editMembersMode">
          <div :class="$style.chatInfoDialogContentTitle">
            <ui3n-icon
              icon="outline-people"
              width="24"
              height="24"
              color="var(--color-icon-block-primary-default)"
            />
            {{ t('chat.dialog.info.btn.edit_members') }}
          </div>

          <ui3n-input
            v-model="userSearch"
            clearable
            :class="$style.chatInfoDialogContentSearch"
            :placeholder="t('chat.dialog.info.search_placeholder')"
          >
            <template #prepend-icon>
              <ui3n-icon
                icon="round-search"
              />
            </template>
          </ui3n-input>

          <div :class="$style.chatInfoDialogUserList">
            <contact-list
              :contact-list="allContacts"
              :non-selectable-contacts="nonDeletableUsers"
              :search-text="userSearch"
              :without-anchor="true"
              :selected-contacts="selectedUsers"
              @select="selectUsers"
            />
          </div>
        </template>

        <template v-else>
          <div :class="$style.chatInfoDialogHeader">
            <chat-avatar
              :name="getChatName(props.chat)"
              size="64"
              :shape="chat.isGroupChat ? 'decagon' : 'circle'"
              :settings="chat.settings"
            />

            <div :class="$style.chatInfoDialogHeaderText">
              <span :class="$style.chatInfoDialogHeaderName">
                {{ getChatName(props.chat) }}
              </span>

              <span :class="$style.chatInfoDialogAutoDeleting">
                <i v-if="autoDeleteMessageInfo.value === AUTODELETE_OFF">
                  {{ t('chat.dialog.info.auto_delete.off') }}
                </i>
                <i v-else>
                  {{ t('chat.dialog.info.auto_delete.txt', { period: t(autoDeleteMessageInfo.label) }) }}
                </i>
              </span>

              <span
                v-if="chat.isGroupChat"
                :class="$style.chatInfoDialogHeaderUser"
              >
                <b>{{ members.length }} {{ t('chat.dialog.info.users') }}</b>
              </span>
            </div>
          </div>

          <div :class="$style.chatInfoDialogContent">
            <div :class="$style.chatInfoDialogContentTitle">
              <ui3n-icon
                icon="outline-account-circle"
                width="24"
                height="24"
                color="var(--color-icon-block-primary-default)"
              />
              {{ t('chat.dialog.info.users') }}

              <ui3n-button
                v-if="chat.isGroupChat && isUserAdmin(ownAddr)"
                type="secondary"
                size="small"
                :class="$style.chatInfoDialogContentTitleBtn"
                @click="openEditMode"
              >
                {{ t('chat.dialog.info.btn.edit_members') }}
              </ui3n-button>
            </div>

            <ui3n-input
              v-model="memberSearch"
              clearable
              :class="$style.chatInfoDialogContentSearch"
              :placeholder="t('chat.dialog.info.search_placeholder')"
            >
              <template #prepend-icon>
                <ui3n-icon
                  icon="round-search"
                />
              </template>
            </ui3n-input>

            <div :class="[$style.chatInfoDialogUserList, isUserAdmin(ownAddr) && $style.pointer]">
              <contact-list
                :contact-list="filteredMembers"
                :without-anchor="true"
                :readonly="true"
                @click:right="openListItemMenu"
              >
                <template #extra="{ mail }">
                  <ui3n-chip
                    v-if="chat.isGroupChat ? isUserPending(mail) || isUserAdmin(mail) : isUserPending(mail)"
                    height="20"
                    :round="false"
                    :color="isUserPending(mail) ? 'var(--warning-fill-default)' : 'var(--info-fill-default)'"
                    :text-color="
                      isUserPending(mail) ? 'var(--warning-content-default)' : 'var(--info-content-default)'
                    "
                    text-size="12"
                  >
                    <template v-if="chat.isGroupChat">
                      {{ t(isUserPending(mail) ? 'chat.dialog.info.user.pending' : 'chat.dialog.info.user.admin') }}
                    </template>

                    <template v-else>
                      {{ t('chat.dialog.info.user.pending') }}
                    </template>
                  </ui3n-chip>
                </template>
              </contact-list>

              <teleport
                v-if="listItemMenuProps.listItem"
                :to="`#${listItemMenuProps.listItemElId}`"
              >
                <list-item-menu
                  :is-open="listItemMenuProps.open"
                  :list-item="listItemMenuProps.listItem"
                  @do="handleAction"
                  @close="closeListItemMenu"
                />
              </teleport>
            </div>
          </div>
        </template>
      </div>
    </template>

    <template #actions>
      <div :class="$style.chatInfoDialogActions">
        <template v-if="editMembersMode">
          <ui3n-button
            type="secondary"
            @click="back"
          >
            {{ t('chat.dialog.info.btn.back') }}
          </ui3n-button>

          <ui3n-button
            :disabled="addBtnDisable"
            @click="updateMembers"
          >
            {{ t('chat.dialog.info.btn.update') }}
          </ui3n-button>
        </template>

        <template v-else>
          <span />

          <ui3n-button
            type="secondary"
            @click="closeDialog"
          >
            {{ capitalize(t('chat.dialog.info.btn.close')) }}
          </ui3n-button>
        </template>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .chatInfoDialog {
    --chat-info-dialog-header-height: 128px;
    --chat-info-dialog-actions-height: 64px;

    position: relative;
    width: v-bind(dialogWidth);
    height: calc(var(--column-size) * 5);
    background-color: var(--color-bg-block-primary-default);
    border-radius: var(--spacing-m);
  }

  /*
    A column that fills the dialog's body slot exactly, so that scrolling
    happens in the list at the bottom of it and nowhere else.

    The slot's own container scrolls (`overflow-y: auto` in ui3n-dialog), so
    anything taller than it takes the whole panel - header, avatar and all -
    with it. Percentage heights inside could not hold that down either: this
    box used to have no height of its own, and `height: calc(100% - ...)` on
    its children resolved against `auto`.

    `min-height: 0` is what lets the list actually shrink: a flex item's floor
    is its content, so without it the list grows to fit every member and pushes
    the column past the dialog instead of scrolling.
  */
  .chatInfoDialogBody {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .chatInfoDialogActions {
    position: relative;
    width: 100%;
    height: var(--chat-info-dialog-actions-height);
    padding: 0 var(--spacing-m);
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid var(--color-border-block-primary-default);

    button {
      text-transform: capitalize;
    }
  }

  .chatInfoDialogHeader {
    position: relative;
    width: 100%;
    height: var(--chat-info-dialog-header-height);
    flex-shrink: 0;
    padding: 0 var(--spacing-m);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    border-bottom: 1px solid var(--color-border-block-primary-default);
  }

  .chatInfoDialogHeaderText {
    position: relative;
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: flex-start;
    row-gap: var(--spacing-s);
  }

  .chatInfoDialogHeaderName {
    display: block;
    font-size: var(--font-14);
    line-height: var(--font-24);
    font-weight: 600;
    color: var(--color-text-control-primary-default);
  }

  .chatInfoDialogAutoDeleting {
    display: block;
    font-size: var(--font-12);
    line-height: var(--font-14);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
  }

  .chatInfoDialogHeaderUser {
    display: block;
    font-size: var(--font-12);
    line-height: var(--font-16);
    font-weight: 500;
    color: var(--color-text-control-secondary-default);
  }

  .chatInfoDialogContent {
    position: relative;
    width: 100%;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .chatInfoDialogContentTitle {
    position: relative;
    width: 100%;
    flex-shrink: 0;
    padding: var(--spacing-m);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-xs);
    font-size: var(--font-16);
    font-weight: 500;
    color: var(--color-text-block-primary-default);
    text-transform: capitalize;
  }

  .chatInfoDialogContentTitleBtn {
    position: absolute;
    right: var(--spacing-m);
  }

  .chatInfoDialogContentSearch {
    width: calc(100% - var(--spacing-l));
    flex-shrink: 0;
    margin: 0 auto var(--spacing-m);
  }

  /* The only scrolling box in the dialog, in both of its modes. */
  .chatInfoDialogUserList {
    position: relative;
    width: 100%;
    padding: 0 var(--spacing-m);
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }

  .pointer {
    div[id] {
      cursor: pointer !important;
    }
  }
</style>
