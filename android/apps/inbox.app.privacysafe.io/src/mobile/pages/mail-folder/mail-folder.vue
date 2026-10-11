<script lang="ts" setup>
  import { computed, useTemplateRef, watch } from 'vue';
  import { useRoute } from 'vue-router';
  import { storeToRefs } from 'pinia';
  import get from 'lodash/get';
  import size from 'lodash/size';
  import uniq from 'lodash/uniq';
  import { useAppStore, useMessagesStore } from '@common/store';
  import { MAIL_FOLDERS_DEFAULT, SYSTEM_FOLDERS } from '@common/constants';
  import { useFolderContent } from '@common/composables/useFolderContent';
  import { useInboxPullToRefresh } from '@mobile/composables/useInboxPullToRefresh';
  import ThreadList from '@common/components/thread-list/thread-list.vue';
  import MessageList from '@common/components/message-list/message-list.vue';
  import MessageBulkActionsToolbar
    from '@mobile/components/message-bulk-actions-toolbar/message-bulk-actions-toolbar.vue';
  import type { MessageBulkActions } from '@common/types';

  const route = useRoute();

  const messagesStore = useMessagesStore();
  const { messagesByFolders, messageThreadsByFolder, messageThreadsFromTrash } = storeToRefs(messagesStore);
  const { commonLoading } = storeToRefs(useAppStore());

  const {
    markedMessages,
    setMarkedMessages,
    resetMarkMessages,
    handleMessageBulkActions,
  } = useFolderContent();

  // Pull-to-refresh, Gmail-style: the rendered list is the scroll container and
  // owns the gesture, so the composable gets its element straight from it.
  const listRef = useTemplateRef<{ listEl: HTMLElement | null }>('listRef');
  const listEl = computed(() => listRef.value?.listEl ?? null);
  useInboxPullToRefresh(listEl, computed(() => commonLoading.value));

  const currentMailFolder = computed(() => {
    const { folderId } = route.params as { folderId: string };
    return MAIL_FOLDERS_DEFAULT.find(mf => mf.id === folderId);
  });

  function _handleMessageBulkActions(action: MessageBulkActions) {
    switch (action) {
      case 'select-all': {
        // eslint-disable-next-line no-useless-assignment
        let msgIds = [];

        if (currentMailFolder.value!.id === SYSTEM_FOLDERS.outbox || currentMailFolder.value!.id === SYSTEM_FOLDERS.draft) {
          msgIds = Object.keys(get(messagesByFolders.value, [currentMailFolder.value!.id, 'data'], {}));
        } else {
          const treads = currentMailFolder.value!.id === SYSTEM_FOLDERS.trash
            ? Object.values(messageThreadsFromTrash.value)
            : get(messageThreadsByFolder.value, currentMailFolder.value!.id, []);

          msgIds = treads.reduce((res, thread) => {
            const { messages = [] } = thread;
            const ids = messages.map(m => m.msgId);
            res = [...res, ...ids];

            return res;
          }, [] as string[]);
        }

        setMarkedMessages(uniq(msgIds));
        break;
      }
      case 'deselect-all':
        resetMarkMessages();
        return;
    }

    handleMessageBulkActions({ action, messageIds: markedMessages.value });
  }

  watch(
    () => currentMailFolder.value?.id,
    (val, oVal) => {
      if (val && val !== oVal) {
        resetMarkMessages();
      }
    }, {
      immediate: true,
    },
  );
</script>

<template>
  <div :class="[$style.mailFolder, size(markedMessages) > 0 && $style.offset]">
    <template v-if="currentMailFolder?.id">
      <message-list
        v-if="currentMailFolder!.id === SYSTEM_FOLDERS.outbox || currentMailFolder!.id === SYSTEM_FOLDERS.draft"
        ref="listRef"
        :folder="currentMailFolder!.id"
      />

      <thread-list
        v-else
        ref="listRef"
        :folder="currentMailFolder!.id"
      />
    </template>



    <div
      v-if="size(markedMessages)"
      :class="$style.mailFolderBulkActions"
    >
      <message-bulk-actions-toolbar
        :folder="currentMailFolder!.id"
        :marked-messages="markedMessages"
        @bulk-actions="_handleMessageBulkActions"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .mailFolder {
    --bulk-actions-toolbar-height: 96px;

    position: relative;
    width: 100%;
    height: 100%;
    overflow-x: hidden;
    overflow-y: auto;

    &.offset {
      padding-top: calc(var(--bulk-actions-toolbar-height) / 2);
    }
  }

  .mailFolderBulkActions {
    position: fixed;
    left: 0;
    width: 100%;
    top: 0;
    height: var(--bulk-actions-toolbar-height);
    background-color: var(--color-bg-block-primary-default);
    border-bottom: 1px solid var(--color-border-block-primary-default);
    z-index: 5;
  }
</style>
