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
  import dayjs from 'dayjs';
  import size from 'lodash/size';
  import {
    type Nullable,
    type TaskRunnerInstance,
    Ui3nButton,
    Ui3nEditable,
    Ui3nIcon,
    Ui3nProgressLinear,
    Ui3nTooltip,
  } from '@v1nt1248/3nclient-lib';
  import { getFileExtension, isFileImage, isFileVideo } from '@v1nt1248/3nclient-lib/utils';
  import { useDblClickHandler } from '@/composables/useDblClickHandler';
  import { useAbilities } from '@/composables/useAbilities';
  import { useEntityNameEditing } from '@/composables/useEntityNameEditing';
  import { useOpenFsEntity } from '@/composables/useOpenFsEntity';
  import { useEntityIcon } from '@/composables/useEntityIcon';
  import { useAppStore, useFsStore, useSyncQueueStore } from '@/store';
  import { createThumbnail as _createThumbnail, getFsEntityTypeIcon, isLinkEntityType } from '@/utils';
  import type { FsFolderEntityEvent, ListingEntryExtended } from '@shared/types';
  import FileType from '@/components/common/file-type/file-type.vue';
  import FsEntitySyncStatus from '@/components/common/fs-entity-sync-status/fs-entity-sync-status.vue';
  import LinkBadge from '@/components/common/link-badge/link-badge.vue';
  import { makeLogger } from '@shared/utils/logger';

  const log = makeLogger('TileViewItem');

  const props = defineProps<{
    windowIndex: 1 | 2;
    fsId: string;
    rootFolderId: string;
    taskRunner: TaskRunnerInstance;
    item: ListingEntryExtended;
    isSelected?: boolean;
    isDroppable?: boolean;
    disabled?: boolean;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { event: FsFolderEntityEvent; payload?: unknown }): void;
    (event: 'select', value: ListingEntryExtended): void;
    (event: 'select:multiple'): void;
  }>();

  const { t } = useI18n();

  const appStore = useAppStore();
  const { uploadProcesses, downloadProcesses, adoptProcesses } = storeToRefs(useSyncQueueStore());
  const { canRename, canSetUnsetFavorite, canCopyMove, canEditEntityIcon } = useAbilities();
  const { editEntityIcon } = useEntityIcon();
  const { openFile } = useFsStore();
  const { openLinkedEntity } = useOpenFsEntity();

  const { handleDblClick } = useDblClickHandler(onClick, onDblClick);


  const editNameMode = ref<boolean>(false);
  const thumbnail = ref<Nullable<string>>(null);
  const isThumbnailCreationProcessGoingOn = ref(false);

  const isItemFromSyncedFsTable = computed(() => props.rootFolderId.includes('synced'));
  const isFsEntryInProcessing = computed(() => uploadProcesses.value.has(props.item.fullPath) || downloadProcesses.value.has(props.item.fullPath) || adoptProcesses.value.has(props.item.fullPath));

  const fileExtension = computed(() => {
    if (props.item.type !== 'file') {
      return '';
    }

    const value = getFileExtension(props.item.name).toLowerCase();
    return size(value) > 5 ? '' : value;
  });

  const entityTypeIcon = computed(() => getFsEntityTypeIcon(props.item.type));
  const isLink = computed(() => isLinkEntityType(props.item.type));

  const displayingCTime = computed(() => props.item.ctime ? dayjs(props.item.ctime).format('YYYY-MM-DD') : '');

  /*
   The body: only a thumbnail fills it; otherwise an icon is shown in its center,
   the custom one or the type one (the same goes for the header).
  */
  const thumbnailImage = computed(() => props.item.thumbnail || thumbnail.value);

  const iconStyle = computed(() => !thumbnailImage.value
    ? { backgroundColor: 'var(--color-bg-control-secondary-default)' }
    : { backgroundImage: `url(${thumbnailImage.value})` },
  );

  const canChangeIcon = computed(
    () => !editNameMode.value && !props.disabled && canEditEntityIcon(props.fsId, props.rootFolderId, props.item),
  );

  function changeIcon() {
    // the folder is reread after a change, the tile gets the new item
    editEntityIcon({ fsId: props.fsId, entity: props.item });
  }

  function onClick(ev: MouseEvent) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    emits('action', { event: 'open:info', payload: { entity: props.item } });
  }

  async function onDblClick() {
    switch (props.item.type) {
      case 'folder': {
        emits('action', { event: 'go', payload: props.item.fullPath });
        return;
      }

      case 'file': {
        await openFile(props.fsId, props.item.fullPath);
        return;
      }

      case 'link-folder':
      case 'link-file':
      case 'link-broken': {
        await openLinkedEntity(props.fsId, props.item, {
          onFolder: path => emits('action', { event: 'go', payload: path }),
        });
        return;
      }
    }
  }

  function selectItem(ev: MouseEvent) {
    const { shiftKey } = ev;
    if (shiftKey) {
      emits('select:multiple');
    } else {
      emits('select', props.item);
    }
  }

  const { editableEl, validateName, onInvalidName, revertName } = useEntityNameEditing();

  function updateName(name: Nullable<string>): void {
    emits('action', { event: 'rename', payload: { entity: props.item, newName: name, revert: revertName } });
  }

  function updateFavorite() {
    if (props.item?.type !== 'folder') {
      return;
    }

    emits('action', { event: 'update:favorite', payload: { entity: props.item } });
  }

  async function createThumbnail() {
    const { type, thumbnail: itemThumbnail, ext = '', fullPath } = props.item;

    const isFileWithThumbnail =
      type === 'file' && (
        isFileImage({ fullName: fullPath.toLowerCase() })
        || isFileVideo({ fullName: fullPath.toLowerCase() })
        || ext.toLowerCase() === 'pdf'
      );
    // the group of a link's target is known only from the target's name
    const isLinkToFile = type === 'link-file';

    if (!itemThumbnail && (isFileWithThumbnail || isLinkToFile)) {
      isThumbnailCreationProcessGoingOn.value = true;

      props.taskRunner.addTask(
        async () => {
          await _createThumbnail(
            props.fsId,
            fullPath,
            props.item.version ?? props.item.mtime?.valueOf(),
            { isLink: isLinkToFile },
          ).then((val) => {
            if (val) {
              thumbnail.value = val;
            }
          }).catch((err) => {
            log.error(`Error creating a thumbnail for '${fullPath}'. `, err);
          }).finally(() => {
            isThumbnailCreationProcessGoingOn.value = false;
          });
        }
      )
    }
  }

  createThumbnail();
</script>

<template>
  <div
    :class="[
      $style.tileViewItem,
      isSelected && $style.selected,
      (disabled || (isFsEntryInProcessing && appStore.connectivityStatus === 'online')) && $style.tileViewItemDisabled,
      isDroppable && $style.droppable
    ]"
    :draggable="!editNameMode && canCopyMove(rootFolderId)"
    @click="handleDblClick"
  >
    <div :class="$style.header">
      <ui3n-icon
        v-if="item.type === 'folder' && canSetUnsetFavorite(fsId, rootFolderId) && !isFsEntryInProcessing && !item.brokeReason"
        icon="round-bookmark"
        width="12"
        height="12"
        :color="item.favoriteId ? 'var(--color-icon-table-accent-selected)' : 'var(--color-icon-table-accent-unselected)'"
        :class="[$style.favoriteIcon, item.favoriteId && $style.favoriteIconSelected]"
        @click.stop="updateFavorite"
      />

      <ui3n-icon
        v-if="isFsEntryInProcessing && appStore.connectivityStatus === 'online'"
        icon="round-lock"
        size="12"
        color="var(--color-icon-control-warning-default)"
        :class="[$style.favoriteIcon, $style.favoriteIconSelected]"
      />

      <div
        :class="$style.icon"
        @click.stop.prevent="selectItem"
      >
        <ui3n-icon
          v-if="isSelected"
          icon="round-check-box"
          :width="20"
          :height="20"
          color="var(--color-icon-control-accent-default)"
        />

        <template v-else>
          <template v-if="isDroppable">
            <ui3n-icon
              icon="round-system-update-alt"
              :rotate="-90"
              color="var(--color-icon-control-accent-default)"
            />
          </template>

          <template v-else>
            <ui3n-icon
              :class="$style.iconCheck"
              icon="round-check-box-outline-blank"
              :width="20"
              :height="20"
              color="var(--color-icon-control-accent-default)"
            />

            <link-badge
              :is-link="isLink"
              :class="$style.iconType"
            >
              <img
                v-if="item.icon"
                :src="item.icon"
                alt=""
                draggable="false"
                :class="$style.customIcon"
              >
              <ui3n-icon
                v-else
                :icon="entityTypeIcon"
                :width="20"
                :height="20"
                color="var(--color-icon-table-secondary-default)"
              />
            </link-badge>
          </template>
        </template>
      </div>

      <ui3n-editable
        ref="editableEl"
        :model-value="item.name"
        disallow-empty-value
        :validator="validateName"
        :disabled="!canRename(fsId, rootFolderId) || !!item.brokeReason"
        @toggle:edit-mode="editNameMode = $event"
        @update:model-value="updateName"
        @invalid="onInvalidName"
      />

      <div
        v-if="canChangeIcon"
        :class="$style.changeIcon"
      >
        <ui3n-tooltip
          :content="t('fs.entity.info.change_icon')"
          position-strategy="fixed"
          placement="top-end"
        >
          <ui3n-button
            type="icon"
            size="small"
            color="transparent"
            icon="outline-image"
            icon-size="20"
            icon-color="var(--color-icon-control-accent-default)"
            @click.stop.prevent="changeIcon"
            @dblclick.stop.prevent
          />
        </ui3n-tooltip>
      </div>

      <ui3n-icon
        v-if="item.brokeReason"
        icon="round-crisis-alert"
        color="var(--error-content-default)"
        :title="`${t('app.damaged')}. ${t('app.damaged_reason')}: ${item.brokeReason}`"
        :class="$style.iconDamaged"
      />
    </div>

    <div
      :class="$style.body"
      :style="iconStyle"
    >
      <link-badge
        v-if="!thumbnailImage"
        :is-link="isLink"
        size="large"
      >
        <img
          v-if="item.icon"
          :src="item.icon"
          alt=""
          draggable="false"
          :class="$style.customIconLarge"
        >
        <ui3n-icon
          v-else
          :icon="entityTypeIcon"
          width="100"
          height="100"
          color="var(--color-icon-table-secondary-default)"
        />
      </link-badge>

      <ui3n-progress-linear
        v-if="isThumbnailCreationProcessGoingOn"
        :class="$style.loader"
        indeterminate
      />
    </div>

    <div :class="$style.footer">
      <file-type
        v-if="fileExtension"
        :file-type="fileExtension"
      />
      <span v-else>&nbsp;</span>

      <span :class="$style.date">{{ displayingCTime }}</span>
    </div>

    <div
      v-if="isItemFromSyncedFsTable"
      :class="$style.syncStatus"
    >
      <fs-entity-sync-status
        :task-runner="taskRunner"
        :fs-id="fsId"
        :row="item"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins' as mixins;

  .tileViewItem {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    background-color: var(--color-bg-table-d-cell-default);
    border-radius: var(--spacing-s);
    padding: var(--spacing-m);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: stretch;
    row-gap: var(--spacing-s);
    cursor: pointer;

    &.selected {
      background-color: var(--color-bg-control-primary-hover);
    }

    &:not(.tileViewItemDisabled):hover {
      background-color: var(--color-bg-control-primary-hover);

      .favoriteIcon {
        opacity: 1;
        cursor: pointer;
      }

      .iconCheck {
        display: block !important;
      }

      .iconType {
        display: none !important;
      }
    }

    &.tileViewItemDisabled {
      pointer-events: none;
      opacity: 0.5;
      cursor: default;
    }
  }

  .droppable {
    position: relative;
    background-color: var(--color-bg-control-primary-hover);
  }

  .header {
    position: relative;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    width: 100%;
    height: var(--spacing-ml);
    padding-left: var(--spacing-ml);
  }

  .name {
    font-size: var(--font-13);
    font-weight: 600;
    color: var(--color-text-control-primary-default);
    @include mixins.text-overflow-ellipsis();
  }

  .favoriteIcon {
    position: absolute;
    left: -14px;
    top: 7px;
    z-index: 2;

    &:not(.favoriteIconSelected) {
      opacity: 0;
    }

    &.favoriteIconSelected {
      opacity: 1;
    }
  }

  .icon {
    position: absolute;
    min-width: 20px;
    width: 20px;
    height: 20px;
    left: 0;
    top: 3px;
    cursor: pointer;
  }

  .iconCheck {
    position: relative;
    display: none !important;
  }

  .customIconLarge {
    display: block;
    width: 100px;
    height: 100px;
    border-radius: var(--spacing-s);
    object-fit: cover;
  }

  .customIcon {
    display: block;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    object-fit: cover;
  }

  .changeIcon {
    flex-shrink: 0;
    margin-left: auto;
  }

  .iconDamaged {
    position: absolute;
    top: 4px;
    right: 4px;
  }

  .body {
    position: relative;
    flex-grow: 1;
    background-color: var(--color-bg-block-primary-default);
    border-radius: var(--spacing-xs);
    display: flex;
    justify-content: center;
    align-items: center;
    background-position: center;
    background-size: cover;
    background-repeat: no-repeat;
  }

  .loader {
    position: absolute !important;
    left: 0;
    bottom: 0;
    width: 100%;
  }

  .footer {
    display: flex;
    width: 100%;
    height: 20px;
    justify-content: space-between;
    align-items: center;
  }

  .date {
    font-size: var(--font-14);
    font-weight: 400;
    color: var(--color-text-table-primary-default);
  }

  .syncStatus {
    position: absolute;
    min-width: 72px;
    top: 0;
    right: 0;
  }
</style>
