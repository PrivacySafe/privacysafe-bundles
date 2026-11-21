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
  import { computed, ref, watch } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import { type Nullable, Ui3nButton, Ui3nDialogEvent } from '@v1nt1248/3nclient-lib';
  import { useMessagesStore } from '@common/store';
  import { msgViewToPreparedMsgData, preparedMsgDataToOutgoingMsgView } from '@common/utils';
  import type {
    IncomingMessageView,
    MessageAction,
    OutgoingMessageView,
    PreparedMessageData,
  } from '@common/types';
  import { useFolderContent } from '@common/composables/useFolderContent';
  import MessageToolbar from '@mobile/components/message-toolbar/message-toolbar.vue';
  import MessageView from '@mobile/components/message-view/message-view.vue';
  import MessageForm from '@mobile/components/message-form/message-form.vue';
  import { SYSTEM_FOLDERS } from '@common/constants';

  const route = useRoute();
  const router = useRouter();

  const { getMessage, deleteMessages } = useMessagesStore();
  const { handleMessageAction } = useFolderContent();

  const sourceFolder = ref<string | undefined>();
  const isFormBusy = ref(false);
  const messageFormEl = ref<InstanceType<typeof MessageForm> | null>(null);
  const currentMessage = ref<Nullable<IncomingMessageView | OutgoingMessageView>>(null);
  const messageInitialData =
    ref<Nullable<{ data: PreparedMessageData; isThisReplyOrForward?: boolean; sourceFolder?: string }>>(null);

  const editMode = computed(() => !route.query.readonly || route.query.readonly === 'no');

  function handleMessageFormAction(value: {
    event: Ui3nDialogEvent<'send' | 'update'>;
    data?: { msgData: PreparedMessageData; withoutSave?: boolean };
  }) {
    const { event, data } = value;
    if (event === 'update') {
      currentMessage.value = preparedMsgDataToOutgoingMsgView(data!.msgData);
    }
  }

  async function goBack() {
    if (editMode.value) {
      await router.push({
        query: {
          readonly: 'yes',
          ...(sourceFolder.value && { sourceFolder: sourceFolder.value }),
        },
      });
      currentMessage.value = getMessage(currentMessage.value!.msgId);
      return;
    }

    await router.push({
      name: 'folder',
      params: { folderId: sourceFolder.value || currentMessage.value?.mailFolder || SYSTEM_FOLDERS.inbox },
    });
  }

  async function handleAction(action: MessageAction) {
    const folderId = currentMessage.value!.mailFolder;

    // Before either of the two that make this record something other than the
    // draft the form holds: a save still waiting would undo the deletion, or
    // write a message already handed to delivery back out as a draft.
    if ((action === 'discard') || (action === 'send')) {
      messageFormEl.value?.cancelPendingSave();
    }

    switch (action) {
      case 'edit':
        messageInitialData.value = { data: msgViewToPreparedMsgData(currentMessage.value!) };
        await router.push({
          query: {
            readonly: 'no',
            ...(sourceFolder.value && { sourceFolder: sourceFolder.value }),
          },
        });
        break;
      case 'discard': {
        await deleteMessages([currentMessage.value!.msgId]);
        await router.push({ name: 'folder', params: { folderId } });
        break;
      }
      case 'report':
        await router.push({
          name: 'report',
          params: { msgId: currentMessage.value!.msgId },
          query: { ...(sourceFolder.value && { sourceFolder: sourceFolder.value }) },
        });
        break;
      case 'block':
      case 'unblock':
      case 'reply':
      case 'reply-all':
      case 'forward':
      case 'mark-as-read':
        await handleMessageAction({ action, message: currentMessage.value!, sourceFolder: sourceFolder.value });
        break;
      case 'send':
      case 'move-to-trash':
      case 'delete':
      case 'restore':
        await handleMessageAction({ action, message: currentMessage.value!, sourceFolder: sourceFolder.value });
        await router.push({
          name: 'folder',
          params: { folderId: sourceFolder.value || currentMessage.value?.mailFolder || SYSTEM_FOLDERS.inbox },
        });
        break;
    }
  }

  watch(
    () => route.params.msgId as string,
    async (val, oVal) => {
      if (val && val !== oVal) {
        const { props } = route.query as { props?: string };
        if (props) {
          messageInitialData.value = JSON.parse(props) as {
            data: PreparedMessageData;
            isThisReplyOrForward?: boolean;
            sourceFolder?: string;
          };
          currentMessage.value = preparedMsgDataToOutgoingMsgView(messageInitialData.value!.data);
          sourceFolder.value = messageInitialData.value.sourceFolder;

          await router.push({
            query: {
              readonly: 'no',
              ...(sourceFolder.value && { sourceFolder: sourceFolder.value }),
            },
          });
        } else {
          currentMessage.value = getMessage(val);
        }
      }
    },
    {
      immediate: true,
    },
  );
</script>

<template>
  <div :class="$style.message">
    <div :class="$style.messageToolbar">
      <ui3n-button
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="round-arrow-back"
        icon-color="var(--color-icon-block-primary-default)"
        icon-size="20"
        @click="goBack()"
      />

      <div :class="$style.messageToolbarBlock">
        <message-toolbar
          :folder="sourceFolder || currentMessage!.mailFolder"
          :edit-mode="editMode"
          :message="currentMessage"
          :busy="isFormBusy"
          @action="handleAction"
        />
      </div>
    </div>

    <div :class="$style.messageBody">
      <message-form
        v-if="editMode && messageInitialData"
        ref="messageFormEl"
        :data="messageInitialData.data"
        :is-this-reply-or-forward="messageInitialData?.isThisReplyOrForward"
        @action="handleMessageFormAction"
        @update:busy="isFormBusy = $event"
      />

      <message-view
        v-if="!editMode && currentMessage"
        :message="currentMessage"
        @mark-as-read="handleAction('mark-as-read')"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .message {
    --message-toolbar-height: 64px;

    position: fixed;
    inset: 0;
    background-color: var(--color-bg-block-primary-default);
  }

  .messageToolbar {
    display: flex;
    width: 100%;
    height: var(--message-toolbar-height);
    justify-content: flex-start;
    align-items: center;
    padding: 0 var(--spacing-s);
    border-bottom: 1px solid var(--color-border-block-primary-default);
  }

  .messageToolbarBlock {
    position: relative;
    width: calc(100% - var(--spacing-l));
    height: 100%;
  }

  .messageBody {
    position: relative;
    width: 100%;
    height: calc(100% - var(--message-toolbar-height) - var(--spacing-ml));
    overflow-x: hidden;
    overflow-y: auto;
  }
</style>
