<!--
 Copyright (C) 2024 - 2025 3NSoft Inc.

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
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import startsWith from 'lodash/startsWith';
  import { Ui3nButton, Ui3nIcon, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import { useFsStore, useSyncQueueStore } from '@/store';
  import { USER_FS } from '@shared/constants';
  import type { RootFsFolderView } from '@shared/types';

  const props = defineProps<{
    folder: RootFsFolderView;
    isSelected?: boolean;
    disabled?: boolean;
  }>();
  const emits = defineEmits<{
    (event: 'select', value: RootFsFolderView): void;
  }>();

  const { t } = useI18n();

  const { rootFolderSyncStatus, trashFolderSyncStatus } = storeToRefs(useSyncQueueStore());

  const fsStore = useFsStore();
  const { fsMountStatus, fsMountBusy } = storeToRefs(fsStore);
  const showMountStatus = computed(
    () => props.folder.id === `${props.folder.fsId}-root` && fsStore.canMountFs(props.folder.fsId),
  );
  const isMounted = computed(() => fsMountStatus.value[props.folder.fsId] === 'mounted');
  const showMountControl = computed(() => showMountStatus.value && props.folder.fsId === USER_FS);
  const mountBusy = computed(() => !!fsMountBusy.value[props.folder.fsId]);
  const mountDisabled = computed(() => !!(props.folder.disabled || props.disabled || mountBusy.value));
  const mountActionLabel = computed(() =>
    t(isMounted.value ? 'fs.mount.button.unmount' : 'fs.mount.button.mount'),
  );

  async function toggleMount(): Promise<void> {
    if (!showMountControl.value || mountDisabled.value) {
      return;
    }

    await fsStore.setFsMounted(props.folder.fsId, !isMounted.value);
  }

  const folderIcon = computed(() => {
    if (showMountStatus.value && props.folder.fsId === USER_FS) {
      return isMounted.value ? 'round-cloud' : 'outline-cloud';
    }

    return props.folder.icon;
  });

  const isItemSystemFolder = computed(() => startsWith(props.folder?.id, 'system'));
  const showConflictingIcon = computed(
    () =>
      (props.folder.id === 'user-synced-root' && rootFolderSyncStatus.value?.state === 'conflicting') ||
      (props.folder.id === 'user-synced-trash' && trashFolderSyncStatus.value?.state === 'conflicting'),
  );
</script>

<template>
  <div
    :class="[
      $style.folderListItem,
      isItemSystemFolder && $style.systemFolderListItem,
      isSelected && $style.selected,
      (folder.disabled || disabled) && $style.disabled,
    ]"
    @click="emits('select', folder)"
  >
    <ui3n-icon
      :icon="folderIcon"
      :size="16"
      :color="
        isSelected ? 'var(--color-icon-control-accent-default)' : 'var(--color-icon-control-secondary-default)'
      "
    />

    <span :class="$style.name">
      {{ t(folder.name) }}
    </span>

    <ui3n-icon
      v-if="showConflictingIcon"
      icon="round-warning"
      :size="12"
      color="var(--color-icon-control-warning-default)"
      :class="$style.status"
    />

    <span
      v-if="showMountControl"
      :class="[$style.mountTrigger, $style.mountTriggerRight]"
      @click.stop
      @dblclick.stop
    >
      <ui3n-tooltip
        :content="mountActionLabel"
        placement="left"
        trigger="hover"
      >
        <ui3n-button
          :class="$style.mountButton"
          type="custom"
          color="transparent"
          :icon="isMounted ? 'round-eject' : 'round-play-arrow'"
          icon-size="20"
          :icon-color="
            isSelected ? 'var(--color-icon-control-accent-default)' : 'var(--color-icon-control-secondary-default)'
          "
          :disabled="mountDisabled"
          :aria-label="mountActionLabel"
          @click="toggleMount"
        />
      </ui3n-tooltip>
    </span>
  </div>
</template>

<style lang="scss" module>
  .folderListItem {
    display: flex;
    width: 100%;
    height: var(--spacing-l);
    min-height: var(--spacing-l);
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    padding: 0 var(--spacing-s);
    border-radius: var(--spacing-xs);
    cursor: pointer;
    margin-bottom: calc(var(--spacing-xs) / 2);

    &.systemFolderListItem {
      .name {
        font-size: var(--font-11);
      }
    }

    &:hover {
      color: var(--color-text-control-primary-hover);
      background-color: var(--color-bg-control-primary-hover);

      & > div {
        color: var(--color-text-control-accent-default) !important;
      }
    }
  }

  .selected {
    color: var(--color-text-control-primary-hover);
    background-color: var(--color-bg-control-primary-hover);

    & > div {
      color: var(--color-text-control-accent-default) !important;
    }
  }

  .disabled {
    pointer-events: none;
    cursor: default;

    div,
    span {
      opacity: 0.5;
    }
  }

  .mountTrigger {
    display: inline-flex;
    flex: 0 0 24px;
    align-items: center;
    justify-content: center;
  }

  .mountButton {
    width: 24px;
    min-width: 24px;
    height: 24px;
    padding: 0 !important;
    margin: 0 !important;

    &:focus-visible {
      outline: 2px solid var(--color-icon-control-accent-default);
      outline-offset: 1px;
    }

    &:hover {
      opacity: 0.5;
    }

    span {
      display: none !important;
    }
  }

  .mountTriggerRight {
    margin-left: auto;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-13);
    font-weight: 600;
    color: var(--color-text-control-primary-default);
  }

  .status {
    flex-shrink: 0;
  }
</style>
