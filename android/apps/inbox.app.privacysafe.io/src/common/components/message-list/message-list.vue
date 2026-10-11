<script lang="ts" setup>
  import { computed, ref, type ComputedRef } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import get from 'lodash/get';
  import isEmpty from 'lodash/isEmpty';
  import { useMessagesStore } from '@common/store';
  import { FOLDER_KEY_BY_ID } from './constants';
  import type { IncomingMessageView, OutgoingMessageView } from '@common/types';
  import MessageListItem from '@common/components/message-list-item/message-list-item.vue';

  const props = defineProps<{
    folder: string;
  }>();

  const { t } = useI18n();
  const { messagesByFolders } = storeToRefs(useMessagesStore());

  const folderEmptyText = computed(() => {
    const folderKey = FOLDER_KEY_BY_ID[props.folder];
    return folderKey ? t(`folder.empty.text.${folderKey}`) : '';
  });

  const messages = computed(() => get(messagesByFolders.value, [props.folder, 'data'], {})) as ComputedRef<
    Record<string, IncomingMessageView | OutgoingMessageView>
  >;
  const messagesList = computed(() => Object.values(messages.value).sort((a, b) => a.deliveryTS - b.deliveryTS));

  // The scroll container itself, so that the phone's pull-to-refresh can tell a
  // pull at the top from ordinary scrolling through older messages.
  const listEl = ref<HTMLDivElement | null>(null);
  defineExpose({ listEl });
</script>

<template>
  <div
    ref="listEl"
    :class="$style.messageList"
  >
    <div
      v-if="isEmpty(messages)"
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
      <message-list-item
        v-for="item in messagesList"
        :key="item.msgId!"
        :item="item"
      />
    </template>
  </div>
</template>

<style lang="scss" module>
  .messageList {
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
