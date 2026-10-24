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
  import { computed, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import get from 'lodash/get';
  import isEmpty from 'lodash/isEmpty';
  import { useMessagesStore } from '@common/store/messages.store';
  import type { MessageThread } from '@common/types';
  import { FOLDER_KEY_BY_ID } from '@common/components/message-list/constants';
  import ThreadListItem from '@common/components/thread-list-item/thread-list-item.vue';
  import { SYSTEM_FOLDERS } from '@common/constants';

  const props = defineProps<{
    folder: string;
  }>();

  const messagesStore = useMessagesStore();
  const { messageThreadsByFolder, messageThreadsFromTrash } = storeToRefs(messagesStore);

  const { t } = useI18n();

  // The scroll container itself, so that the phone's pull-to-refresh can tell a
  // pull at the top from ordinary scrolling through older messages.
  const listEl = ref<HTMLDivElement | null>(null);
  defineExpose({ listEl });

  const folderEmptyText = computed(() => {
    const folderKey = FOLDER_KEY_BY_ID[props.folder];
    return folderKey ? t(`folder.empty.text.${folderKey}`) : '';
  });

  const threads = computed(() => {
    if (props.folder === SYSTEM_FOLDERS.trash) {
      return Object.values(messageThreadsFromTrash.value);
    }

    return get(messageThreadsByFolder.value, props.folder, []) as MessageThread[];
  });
</script>

<template>
  <div
    ref="listEl"
    :class="$style.threadList"
  >
    <div
      v-if="isEmpty(threads)"
      :class="$style.empty"
    >
      <div :class="$style.emptyTitle">
        {{ t('folder.empty.title') }}
      </div>
      <div
        v-if="folderEmptyText"
        :class="$style.emptyText"
      >
        {{ folderEmptyText }}
      </div>
    </div>

    <template v-else>
      <thread-list-item
        v-for="thread in threads"
        :key="thread.threadId"
        :item="thread"
        :folder="folder"
      />
    </template>
  </div>
</template>

<style lang="scss" module>
  .threadList {
    position: relative;
    width: 100%;
    height: 100%;
    background-color: var(--color-bg-block-primary-default);
    overflow-y: auto;
  }

  .empty {
    position: relative;
    width: 100%;
    font-size: var(--font-14);
    font-weight: 400;
    line-height: var(--font-20);
    padding: var(--spacing-m) var(--spacing-l);
  }

  .emptyTitle {
    text-align: center;
    color: var(--color-text-block-primary-default);
  }

  .emptyText {
    text-align: center;
    color: var(--color-text-block-secondary-default);
    margin-top: var(--spacing-m);
  }
</style>
