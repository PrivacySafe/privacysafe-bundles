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
  import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import get from 'lodash/get';
  import size from 'lodash/size';
  import hasIn from 'lodash/hasIn';
  import isEmpty from 'lodash/isEmpty';
  import { VUEBUS_KEY, VueBusPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { type Nullable, Ui3nButton, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import { useAppStore } from '@/common/store/app.store';
  import { inboxSrv } from '@common/services/services-provider';
  import { makeLogger } from '@shared/utils/logger';
  import { useDownloadAttachments } from '@/common/composables/useDownloadAttachments';
  import type { AppGlobalEvents, AttachmentInfo, IncomingMessageView, OutgoingMessageView } from '@common/types';
  import MessageContentAttachment from './message-content-attachment.vue';
  import MessageViewAttachment from '@common/components/dialogs/view-attachment/view-attachment.vue';

  const props = defineProps<{
    message: IncomingMessageView | OutgoingMessageView;
    readonly?: boolean;
  }>();

  const $bus = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;
  const { t } = useI18n();

  const log = makeLogger('MsgAttachments');

  const appStore = useAppStore();

  const isIncomingMessage = computed(() => hasIn(props.message, 'sender'));

  const { downloadAll, downloadAttachment } = useDownloadAttachments({
    msgId: props.message.msgId,
    isIncomingMessage: isIncomingMessage.value,
    t,
  });

  const wrapperEl = ref<Nullable<HTMLDivElement>>(null);
  const bodyEl = ref<Nullable<HTMLDivElement>>(null);
  const isBlockOpen = ref(false);
  const isOverflowing = ref(true);
  const firstRowFilesCount = ref(0);
  const widthOfFirstRowFiles = ref(0);
  const attachmentForView = ref<Nullable<AttachmentInfo>>(null);

  const attachments = computed(() => get(props.message, 'attachmentsInfo', [] as AttachmentInfo[]));
  const widthOfFirstRowFilesCss = computed(() => `${widthOfFirstRowFiles.value}px`);

  /**
   * Whether any of these files was attached on another device of the user. One
   * line for the whole block, rather than the same sentence repeated under every
   * chip; the chips carry the short mark.
   *
   * Attachments of an incoming message are never among them: their bytes are in
   * the SHARED inbox, so every device reads them.
   */
  const someOnAnotherDevice = computed(
    () => !isIncomingMessage.value && attachments.value.some(item => item.hasNoLocalSource),
  );
  const noneAvailable = computed(
    () => !isIncomingMessage.value && attachments.value.every(item => item.hasNoLocalSource),
  );

  /** Previews of this message's attachments, by file name. */
  const thumbnails = ref<Record<string, string>>({});

  // Asked for here rather than in each chip: one call for the message instead of
  // one per attachment.
  async function loadThumbnails(msgId: string) {
    thumbnails.value = await inboxSrv.getThumbnails(msgId).catch(err => {
      log.error(`Failed to read cached previews of the message ${msgId}`, err);
      return {};
    });
  }

  function onThumbnailMade({ fileName, dataUrl }: { fileName: string; dataUrl: string }) {
    thumbnails.value = { ...thumbnails.value, [fileName]: dataUrl };
    inboxSrv
      .saveThumbnail(props.message.msgId, fileName, dataUrl)
      .catch(err => log.error(`Failed to keep the preview of '${fileName}'`, err));
  }

  function initAttachmentListDisplaying() {
    isBlockOpen.value = false;
    isOverflowing.value = true;
    firstRowFilesCount.value = 0;
    widthOfFirstRowFiles.value = 0;

    setTimeout(() => {
      if (wrapperEl.value && bodyEl.value && !isBlockOpen.value) {
        isOverflowing.value = bodyEl.value.clientHeight > wrapperEl.value.clientHeight;

        if (isOverflowing.value) {
          if (isBlockOpen.value || !bodyEl.value || size(bodyEl.value?.children) === 0) {
            firstRowFilesCount.value = 0;
          } else {
            const bodyElWidth = bodyEl.value.clientWidth;
            let startWidth = 0;

            [firstRowFilesCount.value, widthOfFirstRowFiles.value] = [...bodyEl.value.children].reduce(
              (acc, el) => {
                startWidth += el.clientWidth + 8;
                if (startWidth < bodyElWidth) {
                  acc[0] += 1;
                  acc[1] = startWidth;
                }

                return acc;
              },
              [0, 0],
            );
          }
        }
      }
    }, 250);
  }

  function toggleDisplayingAttachments(value: boolean) {
    isBlockOpen.value = value;
  }

  function viewAttachment(attachment: AttachmentInfo) {
    attachmentForView.value = attachment;
  }

  onMounted(() => {
    $bus.$emitter.on('resize-app', initAttachmentListDisplaying);
  });

  onBeforeUnmount(() => {
    $bus.$emitter.off('resize-app', initAttachmentListDisplaying);
  });

  watch(
    () => props.message.msgId,
    (val, oVal) => {
      if (val !== oVal) {
        initAttachmentListDisplaying();
        thumbnails.value = {};
        if (val && !isEmpty(attachments.value)) {
          loadThumbnails(val);
        }
      }
    },
    {
      immediate: true,
    },
  );
</script>

<template>
  <div
    ref="wrapperEl"
    :class="[
      $style.msgAttachments,
      appStore.isMobileMode && $style.mobileMode,
      isBlockOpen && $style.opened,
      isOverflowing && $style.overflowing,
    ]"
  >
    <!-- Hidden rather than disabled when there is nothing here to save, for the
         same reason as the per-file button: a disabled icon button barely looks
         disabled, and its tooltip pops up anyway. Same shape the `readonly` case
         already uses. -->
    <ui3n-tooltip
      :content="t('msg.content.tooltip.download_all')"
      position-strategy="fixed"
      placement="top-end"
      :disabled="readonly || noneAvailable"
    >
      <ui3n-button
        v-if="!readonly && !noneAvailable"
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="outline-download-for-offline"
        icon-color="var(--color-icon-button-secondary-default)"
        icon-size="24"
        :class="$style.downloadAll"
        @click.stop.prevent="downloadAll(message.attachmentsInfo || [])"
      />
    </ui3n-tooltip>

    <div
      v-if="someOnAnotherDevice"
      :class="$style.onAnotherDeviceNote"
    >
      {{ t('msg.attachments.on_another_device') }}
    </div>

    <div
      ref="bodyEl"
      :class="$style.attachmentsBody"
    >
      <template
        v-for="attachment in attachments"
        :key="attachment.id"
      >
        <message-content-attachment
          :attachment="attachment"
          :msg-id="message.msgId"
          :is-incoming-message="isIncomingMessage"
          :cached-thumbnail="thumbnails[attachment.fileName]"
          @download="downloadAttachment"
          @view="viewAttachment"
          @thumbnail="onThumbnailMade"
        />
      </template>

      <ui3n-button
        v-if="isOverflowing && isBlockOpen"
        type="secondary"
        :class="$style.lessBtn"
        @click.stop.prevent="toggleDisplayingAttachments(false)"
      >
        {{ t('msg.content.btn.attachments_collapse') }}
      </ui3n-button>
    </div>

    <ui3n-button
      v-if="isOverflowing && !isBlockOpen && firstRowFilesCount !== 0"
      type="secondary"
      :class="$style.moreBtn"
      @click.stop.prevent="toggleDisplayingAttachments(true)"
    >
      +{{ size(attachments) - firstRowFilesCount }}
    </ui3n-button>

    <teleport to="body">
      <message-view-attachment
        v-if="attachmentForView"
        :item="attachmentForView"
        :msg-id="message.msgId"
        :is-incoming-message="isIncomingMessage"
        @close="attachmentForView = null"
      />
    </teleport>
  </div>
</template>

<style lang="scss" module>
  @use '@common/assets/styles/mixins' as mixins;

  .msgAttachments {
    --msg-attachments-min-height: 128px;
    --msg-attachments-min-mobile-height: 172px;

    position: relative;
    width: 100%;
    min-height: var(--msg-attachments-min-height);
    padding-right: var(--spacing-xl);
    overflow: hidden;

    &.mobileMode {
      height: auto;
    }

    &.opened {
      height: auto;
    }
  }

  .downloadAll {
    position: absolute !important;
    right: var(--spacing-xs);
    top: 0;
  }

  .onAnotherDeviceNote {
    font-size: var(--font-12);
    line-height: var(--font-16);
    color: var(--color-text-block-secondary-default);
    padding-bottom: var(--spacing-xs);
  }

  .attachmentsBody {
    display: flex;
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
    align-items: flex-start;
    gap: var(--spacing-s);
  }

  .attachment {
    position: relative;
    width: max-content;
    max-width: 200px;
    height: var(--spacing-ml);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    padding: 0 var(--spacing-ml);
    border-radius: var(--spacing-xs);
    background-color: var(--color-bg-control-secondary-default);

    &.attachmentReadonly {
      padding-right: var(--spacing-s);
    }
  }

  .prependIcon {
    position: absolute;
    left: var(--spacing-xs);
    top: var(--spacing-xs);
  }

  .fileName {
    user-select: none;
    font-size: var(--font-12);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
    @include mixins.text-overflow-ellipsis();
  }

  .btn {
    position: absolute;
    width: var(--spacing-m);
    min-width: var(--spacing-m);
    height: var(--spacing-m);
    min-height: var(--spacing-m);
    border-radius: 50%;
    display: flex;
    justify-content: center;
    align-items: center;
    top: var(--spacing-xs);
    right: var(--spacing-xs);
    cursor: pointer;

    &:hover {
      background-color: var(--color-bg-button-secondary-hover);
    }
  }

  .moreBtn,
  .lessBtn {
    height: var(--spacing-ml) !important;
    padding: var(--spacing-xs) var(--spacing-s) !important;
  }

  .moreBtn {
    position: absolute !important;
    width: var(--spacing-xl) !important;
    top: 52px !important;
    left: v-bind(widthOfFirstRowFilesCss);
  }

  .lessBtn {
    align-self: center;
  }
</style>
