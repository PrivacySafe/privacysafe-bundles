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
  import { isFileImage, getFileExtension, isFileVideo, isFileAudio } from '@v1nt1248/3nclient-lib/utils';
  import { type Nullable, Ui3nButton, Ui3nIcon, Ui3nProgressCircular, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import { useAppStore } from '@/common/store/app.store';
  import { createThumbnail } from '@/common/utils/create-thumbnail';
  import { THUMBNAIL_AUTO_PREVIEW_LIMIT } from '@shared/constants/attachment-limits';
  import { attachmentAvailabilityOf } from '@shared/utils/attachment-availability';
  import type { AttachmentInfo } from '@common/types';

  const props = defineProps<{
    msgId: string;
    isIncomingMessage?: boolean;
    attachment: AttachmentInfo;
    /** Preview made earlier and kept, if there is one. */
    cachedThumbnail?: string;
  }>();

  const emits = defineEmits<{
    (event: 'download', value: AttachmentInfo): void;
    (event: 'view', value: AttachmentInfo): void;
    (event: 'thumbnail', value: { fileName: string; dataUrl: string }): void;
  }>();

  const { t } = useI18n();

  const appStore = useAppStore();

  const isProcessing = ref(false);
  /** The file was asked for and is not there — moved, renamed or deleted. */
  const isFileMissing = ref(false);
  const iconSize = 88;
  const iconSizeCss = computed(() => `${iconSize}px`);

  const fileExt = computed(() => (getFileExtension(props.attachment.fileName) || '').toLowerCase());
  const isThumbnailAvailable = computed(
    () =>
      (isFileImage({ fullName: props.attachment.fileName }) ||
        isFileVideo({ fullName: props.attachment.fileName }) ||
        fileExt.value === 'pdf') &&
      props.attachment.size,
  );
  /**
   * The file was attached on another device of the user, and only the record
   * travelled here.
   *
   * Deliberately NOT folded into isBroken. That one says the file was deleted,
   * moved or renamed — which about a whole and well file sitting on the user's
   * phone is simply untrue, and is exactly what would be said if nothing were
   * done here: createThumbnail returns null and isFileMissing goes true.
   */
  const isOnAnotherDevice = computed(
    () =>
      attachmentAvailabilityOf(props.attachment, props.isIncomingMessage ? props.msgId : undefined) ===
      'on-another-device',
  );
  const isViewAvailable = computed(
    () =>
      !isFileMissing.value &&
      !isOnAnotherDevice.value &&
      (isThumbnailAvailable.value ||
        (isFileAudio({ fullName: props.attachment.fileName }) && props.attachment.size)),
  );
  const isBroken = computed(() => !isOnAnotherDevice.value && (!props.attachment.size || isFileMissing.value));
  const brokenTitle = computed(() => t('msg.attachment.link_broken', { fileName: props.attachment.fileName }));
  const onAnotherDeviceTitle = computed(() =>
    t('msg.attachment.on_another_device', { fileName: props.attachment.fileName }),
  );

  /**
   * Whether a preview of this file can ever appear in the square.
   *
   * A file on another device of the user has a previewable *type* and no bytes
   * here, so the square would stay empty for good — hence the type icon instead.
   * A big local file keeps the empty square: there a preview is one click away.
   */
  const isPreviewPossible = computed(() => isThumbnailAvailable.value && !isOnAnotherDevice.value);

  const iconName = computed(() => {
    if (isPreviewPossible.value) {
      return '';
    }

    if (
      ['zip', '7z', 'ace', 'cab', 'cbr', 'gz', 'gzip', 'jar', 'rar', 'tar', 'tgz', 'zipx'].includes(fileExt.value)
    ) {
      return 'file-zip';
    }

    if (isFileAudio({ fullName: props.attachment.fileName })) {
      return 'outline-audio-file';
    }

    if (isFileImage({ fullName: props.attachment.fileName })) {
      return 'outline-image';
    }

    if (isFileVideo({ fullName: props.attachment.fileName })) {
      return 'outline-video-file';
    }

    // PDF among them: the icon set has nothing pdf-specific.
    return 'outline-file-present';
  });

  const imageDataUrl = ref<Nullable<string>>(null);
  const imageViewStyle = computed(() => {
    if (!imageDataUrl.value) {
      return '';
    }

    return { backgroundImage: `url('${imageDataUrl.value}')` };
  });

  /**
   * Making a preview needs the whole file, and an incoming attachment is not on
   * this device until something reads it. So a big one waits to be asked for:
   * otherwise opening a message with ten photos pulls all ten from the server.
   */
  const isPreviewOnDemand = computed(
    () =>
      isPreviewPossible.value &&
      !imageDataUrl.value &&
      !isProcessing.value &&
      (props.attachment.size ?? 0) > THUMBNAIL_AUTO_PREVIEW_LIMIT,
  );

  /**
   * Whether to offer downloading at all.
   *
   * Not merely `disabled` for a file on another device: the disabled state of an
   * icon button is all but invisible — its `[disabled]` rule touches only the
   * button's own background and colour, while the glyph keeps the `icon-color`
   * passed in — and the tooltip pops up regardless, `pointer-events: none` being
   * on the button rather than on the tooltip's wrapper. A button that cannot be
   * pressed and does not look it is worse than no button.
   *
   * `isBroken` keeps its disabled button: there the file is meant to be here and
   * the user has something to fix.
   */
  const isDownloadable = computed(() => !isOnAnotherDevice.value);

  /**
   * `.actions` is `inset: 0` with a translucent grey fill, so an empty one would
   * paint the whole chip on hover - over the "On another device" caption - and
   * offer nothing.
   */
  const hasActions = computed(
    () => isDownloadable.value || isPreviewOnDemand.value || isViewAvailable.value,
  );

  async function makeThumbnail() {
    if (!isThumbnailAvailable.value) {
      return;
    }

    isProcessing.value = true;
    try {
      const dataUrl = await createThumbnail({
        attachment: props.attachment,
        incomingMsgId: props.isIncomingMessage ? props.msgId : undefined,
        targetSize: 128,
      });
      imageDataUrl.value = dataUrl;
      // No thumbnail from a file that should have one means the file itself
      // could not be read; saying so beats offering a view that shows nothing.
      isFileMissing.value = !dataUrl;
      if (dataUrl) {
        // Kept, so that reopening the message does not read the file again.
        emits('thumbnail', { fileName: props.attachment.fileName, dataUrl });
      }
    } finally {
      isProcessing.value = false;
    }
  }

  function downloadAttachment() {
    if (!props.attachment.size) {
      return;
    }

    emits('download', props.attachment);
  }

  // A preview already made is the cheapest case of all: nothing is read.
  if (props.cachedThumbnail) {
    imageDataUrl.value = props.cachedThumbnail;
  } else if (!isOnAnotherDevice.value && (props.attachment.size ?? 0) <= THUMBNAIL_AUTO_PREVIEW_LIMIT) {
    // Without the guard, opening the message starts a read that is bound to
    // return null - and to leave the "deleted, moved or renamed" mark behind.
    makeThumbnail();
  }
</script>

<template>
  <div :class="[$style.msgAttachment, appStore.isMobileMode && $style.mobileMode]">
    <div
      :class="[$style.thumbnail, !imageViewStyle && isPreviewPossible && $style.empty]"
      :style="imageViewStyle"
    >
      <ui3n-icon
        v-if="!isPreviewPossible"
        :icon="iconName"
        color="var(--color-icon-block-secondary-default)"
        :size="iconSize - 16"
      />

      <div
        v-if="isProcessing"
        :class="$style.loader"
      >
        <ui3n-progress-circular
          size="56"
          indeterminate
        />
      </div>

      <ui3n-tooltip
        v-else-if="isBroken"
        :content="brokenTitle"
        placement="top"
        position-strategy="fixed"
        max-content-width="200"
      >
        <ui3n-icon
          icon="round-crisis-alert"
          color="var(--color-icon-block-warning-default)"
          size="16"
          :class="$style.broken"
        />
      </ui3n-tooltip>
    </div>

    <div
      v-if="isOnAnotherDevice"
      :class="$style.onAnotherDevice"
    >
      {{ t('msg.attachment.on_another_device_short') }}
    </div>

    <div :class="$style.name">
      <ui3n-tooltip
        :content="isOnAnotherDevice ? onAnotherDeviceTitle : attachment.fileName"
        placement="top"
        position-strategy="fixed"
        max-content-width="160"
      >
        <span>{{ attachment.fileName }}</span>
      </ui3n-tooltip>
    </div>

    <div
      v-if="hasActions"
      :class="$style.actions"
    >
      <!-- v-if on the TOOLTIP, not on the button: the tooltip's own wrapper is
           what the pointer hits, so leaving it would pop "Download the file"
           over nothing. -->
      <ui3n-tooltip
        v-if="isDownloadable"
        :content="t('msg.content.tooltip.download')"
        placement="top"
        position-strategy="fixed"
        max-content-width="160"
      >
        <ui3n-button
          type="icon"
          color="color(from var(--color-bg-block-primary-default) srgb 75% 75% 75% / 0.5)"
          icon="outline-download-for-offline"
          icon-size="24"
          icon-color="var(--color-icon-button-tritery-default)"
          :disabled="isBroken"
          @click.stop.prevent="downloadAttachment"
        />
      </ui3n-tooltip>

      <ui3n-tooltip
        v-if="isPreviewOnDemand"
        :content="t('msg.content.tooltip.make_preview')"
        placement="top"
        position-strategy="fixed"
        max-content-width="180"
      >
        <ui3n-button
          type="icon"
          color="color(from var(--color-bg-block-primary-default) srgb 75% 75% 75% / 0.5)"
          icon="outline-image"
          icon-size="24"
          icon-color="var(--color-icon-button-tritery-default)"
          @click.stop.prevent="makeThumbnail"
        />
      </ui3n-tooltip>

      <ui3n-tooltip
        v-if="isViewAvailable"
        :content="t('msg.content.tooltip.view')"
        placement="top"
        position-strategy="fixed"
        max-content-width="160"
      >
        <ui3n-button
          v-if="isViewAvailable"
          type="icon"
          color="color(from var(--color-bg-block-primary-default) srgb 75% 75% 75% / 0.5)"
          icon="outline-preview"
          icon-size="24"
          icon-color="var(--color-icon-button-tritery-default)"
          @click.stop.prevent="emits('view', attachment)"
        />
      </ui3n-tooltip>
    </div>
  </div>
</template>

<style lang="scss" module>
  .msgAttachment {
    --msg-attachment-width: 128px;
    --msg-attachment-height: 128px;
    --msg-attachment-mobile-height: 172px;
    --msg-attachment-icon-size: v-bind(iconSizeCss);

    position: relative;
    width: var(--msg-attachment-width);
    height: var(--msg-attachment-height);
    padding: var(--spacing-xs);
    background-color: var(--color-bg-block-primary-default);
    cursor: pointer;
    padding-bottom: 40px;
    overflow: hidden;
    border-radius: var(--spacing-xs);
    border: 1px solid var(--color-border-block-primary-default);

    &:hover {
      .actions {
        display: flex;
      }
    }

    &.mobileMode {
      --msg-attachment-width: calc(50% - var(--spacing-s));

      height: var(--msg-attachment-mobile-height);

      .actions {
        display: flex;
        left: 0;
        width: 100%;
        height: var(--spacing-xl);
        top: calc(var(--msg-attachment-icon-size) + var(--spacing-l));
        background-color: transparent;
      }
    }
  }

  .thumbnail {
    position: relative;
    min-width: var(--msg-attachment-icon-size);
    width: var(--msg-attachment-icon-size);
    min-height: var(--msg-attachment-icon-size);
    height: var(--msg-attachment-icon-size);
    background-position: center;
    background-size: contain;
    background-repeat: no-repeat;
    margin: 0 auto;
    display: flex;
    justify-content: center;
    align-items: center;

    .broken {
      position: absolute;
      top: -2px;
      right: -2px;
    }

    &.empty {
      background-color: color(from var(--color-bg-block-primary-default) srgb 75% 75% 75% / 0.5);
      border-radius: 4px;
    }
  }

  .loader {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 5;
  }

  .actions {
    display: none;
    position: absolute;
    inset: 0;
    background-color: color(from var(--color-bg-block-primary-default) srgb 75% 75% 75% / 0.5);
    border-radius: 4px;
    z-index: 3;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-xs);
  }

  .onAnotherDevice {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    // Below .actions (3), so hovering the chip still gets the buttons.
    z-index: 2;
    padding: 1px var(--spacing-xs);
    font-size: var(--font-10);
    line-height: var(--font-12);
    color: var(--color-text-control-secondary-default);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .name {
    user-select: none;
    font-size: var(--font-12);
    font-weight: 500;
    line-height: var(--font-16);
    color: var(--color-text-control-primary-default);
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    text-overflow: ellipsis;
    text-align: center;

    span {
      overflow: hidden;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      line-clamp: 2;
      -webkit-line-clamp: 2;
      text-overflow: ellipsis;
      text-align: center;
    }
  }
</style>
