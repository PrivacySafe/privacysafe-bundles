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
  import { computed, onBeforeUnmount, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import dayjs from 'dayjs';
  import isEmpty from 'lodash/isEmpty';
  import {
    type Nullable,
    Ui3nButton,
    Ui3nChip,
    Ui3nIcon,
    Ui3nProgressCircular,
    Ui3nTooltip,
    Ui3nClickOutside,
  } from '@v1nt1248/3nclient-lib';
  import { formatFileSize, isFileImage, isFileVideo } from '@v1nt1248/3nclient-lib/utils';
  import { useFsStore } from '@/store';
  import { useAbilities } from '@/composables/useAbilities';
  import { useEntityIcon } from '@/composables/useEntityIcon';
  import { useFileHashing } from './useFileHashing';
  import { createThumbnail, getFsEntityTypeIcon, isLinkEntityType } from '@/utils';
  import type { FsSEntityInfoProps, FsSEntityInfoEmits } from './types';
  import type { ListingEntryExtended } from '@shared/types';
  import type { EntitySyncStatus } from '@deno/types.ts';
  import { makeLogger } from '@shared/utils/logger';
  import LinkBadge from '@/components/common/link-badge/link-badge.vue';

  const log = makeLogger('FsEntityInfo');

  const vUi3nClickOutside = Ui3nClickOutside;

  const props = defineProps<FsSEntityInfoProps>();
  const emits = defineEmits<FsSEntityInfoEmits>();

  const { t } = useI18n();
  const { getEntityStats, getSyncedStatus } = useFsStore();
  const { canEditEntityIcon } = useAbilities();
  const { isIconEditorOpen, editEntityIcon } = useEntityIcon();

  const isLoading = ref(false);
  const entityStats = ref<Nullable<ListingEntryExtended & { thumbnail?: string }>>(null);
  const entitySyncStatus = ref<EntitySyncStatus>({} as EntitySyncStatus);

  const fsIdValue = computed(() => props.fsId);
  const pathValue = computed(() => props.path);

  const {
    canHash,
    sha256hex,
    calculating256,
    sha256progress,
    sha512hex,
    calculating512,
    sha512progress,
    calculateHash,
    loadHashing,
    stopHashingProcess,
  } = useFileHashing(fsIdValue, pathValue, entityStats);

  /*
   The large block: only a thumbnail fills it; otherwise an icon is shown in its
   center, the custom one or the type one (the same goes for the Type row).
  */
  const thumbnailImage = computed(() => entityStats.value?.thumbnail);

  const iconStyle = computed(() =>
    !thumbnailImage.value
      ? { backgroundColor: 'var(--color-bg-control-secondary-default)' }
      : { backgroundImage: `url(${thumbnailImage.value})` },
  );

  const canChangeIcon = computed(
    () => !!entityStats.value && canEditEntityIcon(props.fsId, props.rootFolderId ?? null, entityStats.value),
  );

  async function changeIcon() {
    if (!entityStats.value) {
      return;
    }
    const isChanged = await editEntityIcon({ fsId: props.fsId, entity: entityStats.value });
    if (isChanged) {
      await loadEntity(props.fsId, props.path);
    }
  }

  function onClickOutside(event: MouseEvent) {
    // the icon editor is a dialog on top of the page, i.e. outside of this panel
    const target = event.target as Element | null;
    if (isIconEditorOpen.value || !target?.isConnected || target.closest('[data-ui3n="dialog-overlay"]')) {
      return;
    }
    emits('close');
  }

  const entityTypeIcon = computed(() => getFsEntityTypeIcon(entityStats.value?.type ?? 'file'));
  const isLink = computed(() => !!entityStats.value && isLinkEntityType(entityStats.value.type));

  const entityType = computed(() => {
    if (!entityStats.value) {
      return '';
    }

    return t(`fs.entity.info.type_${entityStats.value!.type}`);
  });

  const entityPath = computed(() => {
    if (!entityStats.value) {
      return '';
    }

    const arr = entityStats.value!.fullPath.split('/');
    return arr.join(' / ');
  });

  const entitySize = computed(() => {
    if (!entityStats.value || !entityStats.value!.type || entityStats.value!.type === 'folder') {
      return '-';
    }

    return formatFileSize(entityStats.value!.size);
  });

  const entityDate = computed(() => {
    if (!entityStats.value || !entityStats.value?.ctime) {
      return '';
    }

    return dayjs(entityStats.value!.ctime).format('YYYY-MM-DD HH:mm');
  });

  const entityChanges = computed(() => {
    if (!entityStats.value || !entityStats.value?.mtime) {
      return '';
    }

    return dayjs(entityStats.value!.mtime).format('YYYY-MM-DD HH:mm');
  });

  const entityTags = computed(() => {
    if (!entityStats.value || isEmpty(entityStats.value?.tags)) {
      return [];
    }

    return entityStats.value!.tags;
  });

  /*
   The panel follows the selected entity. Answers for a previous selection may
   come after the current one; each load has an id, and only the latest one may
   update the panel.
  */
  let currentLoadId = 0;

  async function loadEntity(fsId: string, fullPath: string) {
    const loadId = ++currentLoadId;
    const isCurrentLoad = () => loadId === currentLoadId;

    stopHashingProcess();
    entityStats.value = null;
    entitySyncStatus.value = {} as EntitySyncStatus;

    try {
      isLoading.value = true;
      const stats = (await getEntityStats({ fsId, fullPath })) || null;
      if (!isCurrentLoad()) {
        return;
      }
      entityStats.value = stats;
      // a link to a file is hashed by its target, if the target can be opened
      if (stats?.type === 'file' || stats?.type === 'link-file') {
        await loadHashing();
      }
    } catch (err) {
      log.error(`Error loading the information about '${fullPath}'. `, err);
    } finally {
      if (isCurrentLoad()) {
        isLoading.value = false;
      }
    }

    if (!isCurrentLoad() || !entityStats.value) {
      return;
    }

    if (fsId.includes('synced')) {
      const sStatus = await getSyncedStatus({ fsId, fullPath }).catch(() => undefined);
      if (isCurrentLoad()) {
        entitySyncStatus.value = sStatus || ({} as EntitySyncStatus);
      }
    }

    const { type, thumbnail, ext } = entityStats.value ?? {};
    const isFileWithThumbnail =
      type === 'file' &&
      (isFileImage({ fullName: fullPath.toLowerCase() }) ||
        isFileVideo({ fullName: fullPath.toLowerCase() }) ||
        ext === 'pdf');
    // the group of a link's target is known only from the target's name
    const isLinkToFile = type === 'link-file';
    if (!thumbnail && (isFileWithThumbnail || isLinkToFile)) {
      createThumbnail(fsId, fullPath, entityStats.value.version ?? entityStats.value.mtime?.valueOf(), {
        isLink: isLinkToFile,
      })
        .then(val => {
          // the thumbnail belongs to this entity only
          if (val && isCurrentLoad() && entityStats.value) {
            entityStats.value.thumbnail = val;
          }
        })
        .catch(err => log.error(`Error creating a thumbnail for '${fullPath}'. `, err));
    }
  }

  watch(
    [() => props.fsId, () => props.path],
    ([fsId, path], [oFsId, oPath]) => {
      if (path && (path !== oPath || fsId !== oFsId)) {
        loadEntity(fsId, path);
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    stopHashingProcess();
  });
</script>

<template>
  <div
    v-ui3n-click-outside="onClickOutside"
    :class="$style.fsEntityInfo"
  >
    <div
      :class="$style.header"
      @click="emits('close')"
    >
      <span :title="entityStats?.name">
        {{ entityStats?.name }}
      </span>

      <ui3n-button
        type="icon"
        size="small"
        color="var(--color-bg-block-primary-default)"
        icon="round-close"
        icon-color="var(--color-icon-control-primary-default)"
        icon-size="16"
      />
    </div>

    <div :class="$style.iconBlock">
      <ui3n-icon
        v-if="entityStats?.favoriteId"
        icon="round-bookmark"
        width="16"
        height="16"
        color="var(--color-icon-table-accent-selected)"
        :class="$style.favorite"
      />

      <div
        :class="$style.iconWrapper"
        :style="iconStyle"
      >
        <link-badge
          v-if="!thumbnailImage"
          :is-link="isLink"
          size="large"
        >
          <img
            v-if="entityStats?.icon"
            :src="entityStats.icon"
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
      </div>
    </div>

    <div :class="$style.content">
      <div :class="[$style.row, $style.typeRow]">
        <span>{{ t('fs.entity.info.type') }}</span>
        <div>
          <link-badge
            v-if="entityStats"
            :is-link="isLink"
          >
            <img
              v-if="entityStats.icon"
              :src="entityStats.icon"
              alt=""
              draggable="false"
              :class="$style.customIcon"
            >
            <ui3n-icon
              v-else
              :icon="entityTypeIcon"
              :size="20"
              color="var(--color-icon-table-secondary-default)"
            />
          </link-badge>

          {{ entityType }}
        </div>

        <div
          v-if="canChangeIcon"
          :class="$style.rowAction"
        >
          <ui3n-tooltip
            :content="t('fs.entity.info.change_icon')"
            position-strategy="fixed"
            placement="top-end"
          >
            <ui3n-button
              type="icon"
              size="small"
              color="var(--color-bg-block-primary-default)"
              icon="outline-image"
              icon-size="20"
              icon-color="var(--color-icon-control-accent-default)"
              @click.stop.prevent="changeIcon"
            />
          </ui3n-tooltip>
        </div>
      </div>

      <div :class="$style.row">
        <span>{{ t('fs.entity.info.path') }}</span>
        <div>{{ entityPath }}</div>
      </div>

      <div :class="$style.row">
        <span>{{ t('fs.entity.info.size') }}</span>
        <div>{{ entitySize }}</div>
      </div>

      <div :class="$style.row">
        <span>{{ t('fs.entity.info.date') }}</span>
        <div>{{ entityDate }}</div>
      </div>

      <div :class="$style.row">
        <span>{{ t('fs.entity.info.changes') }}</span>
        <div>{{ entityChanges }}</div>
      </div>

      <div :class="$style.row">
        <span>{{ t('fs.entity.info.tags') }}</span>
        <div>
          <Ui3nChip
            v-for="tag in entityTags"
            :key="tag"
            :round="false"
            height="14"
            text-size="9"
            color="'var(--color-bg-control-secondary-default)'"
            text-color="var(--color-text-control-primary-default)"
          >
            {{ tag }}
          </Ui3nChip>
        </div>
      </div>

      <div
        v-if="fsId.includes('synced')"
        :class="$style.row"
      >
        <span>{{ t('fs.entity.info.status') }}</span>
        <section>
          <p>
            {{ t('fs.entity.info.sync_state') }}: <i>{{ entitySyncStatus?.state && t(`fs.sync_state.${entitySyncStatus.state}`) }}</i>
          </p>

          <p v-if="entitySyncStatus?.local">
            {{ t('fs.entity.info.local_version') }}: <i>{{ entitySyncStatus?.local.latest }}</i>
          </p>

          <p v-if="entitySyncStatus?.synced">
            {{ t('fs.entity.info.synced_version') }}: <i>{{ entitySyncStatus?.synced.latest }}</i>
          </p>

          <p v-if="entitySyncStatus?.remote">
            {{ t('fs.entity.info.remote_version') }}: <i>{{ entitySyncStatus?.remote.latest }}</i>
          </p>
        </section>
      </div>

      <template v-if="canHash">
        <div
          v-if="(!sha256hex || !sha512hex) && !(calculating256 || calculating512)"
          :class="$style.actions"
        >
          <ui3n-button
            type="secondary"
            @click.stop.prevent="calculateHash"
          >
            {{ t('fs.entity.info.calculate_hash') }}
          </ui3n-button>
        </div>

        <div
          v-if="sha256hex || calculating256"
          :class="$style.row"
        >
          <span>SHA-256</span>

          <div v-if="sha256hex">
            {{ sha256hex }}
          </div>

          <div
            v-if="calculating256"
            :class="$style.progress"
          >
            {{ sha256progress }}%
          </div>
        </div>

        <div
          v-if="sha512hex || calculating512"
          :class="$style.row"
        >
          <span>SHA-512</span>

          <div v-if="sha512hex">
            {{ sha512hex }}
          </div>

          <div
            v-if="calculating512"
            :class="$style.progress"
          >
            {{ sha512progress }}%
          </div>
        </div>
      </template>
    </div>

    <div
      v-if="isLoading"
      :class="$style.loader"
    >
      <ui3n-progress-circular
        indeterminate
        size="80"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '../../../assets/styles/mixins' as mixins;

  .fsEntityInfo {
    position: relative;
    width: 100%;
    height: 100%;
    background-color: var(--color-bg-block-primary-default);
  }

  .header {
    display: flex;
    width: 100%;
    height: 36px;
    padding: 0 var(--spacing-m);
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-s);
    border-bottom: 1px solid var(--color-border-block-primary-default);
    font-size: var(--font-14);
    font-weight: 600;
    color: var(--color-text-table-primary-default);

    span {
      display: block;
      @include mixins.text-overflow-ellipsis();
    }

    button {
      transform-origin: center;
      transform: rotate(90deg);
    }
  }

  .actions {
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .iconBlock {
    position: relative;
    width: 100%;
    padding: var(--spacing-ml) 0;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .iconWrapper {
    position: relative;
    width: 200px;
    height: 200px;
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: var(--spacing-m);
    border: 1px solid var(--color-border-block-primary-default);
    background-position: center;
    background-size: cover;
    background-repeat: no-repeat;
  }

  .content {
    position: relative;
    width: calc(100% - var(--spacing-xs));
    height: calc(100% - 292px);
    overflow-y: auto;
  }

  .favorite {
    position: absolute;
    top: var(--spacing-m);
    right: var(--spacing-m);
  }

  .row {
    display: flex;
    width: 100%;
    padding: var(--spacing-xs) var(--spacing-m);
    justify-content: flex-start;
    align-items: flex-start;
    column-gap: var(--spacing-s);
    margin-bottom: var(--spacing-xs);
    font-size: var(--font-12);
    line-height: var(--font-16);

    > span {
      display: block;
      position: relative;
      width: 64px;
      min-width: 64px;
      font-weight: 600;
      color: var(--color-text-table-secondary-default);
    }

    // the value cell; components inside it (icons, chips, tooltips) keep their own styles
    > div:not([data-ui3n], .rowAction) {
      position: relative;
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-start;
      gap: var(--spacing-xs);
      align-items: center;
      font-weight: 400;
      color: var(--color-text-table-primary-default);
      white-space: break-spaces;
      word-break: break-word;

      &.progress {
        font-weight: 600;
        color: var(--color-text-control-accent-default);
      }
    }

    p {
      margin: 0 0 var(--spacing-xs) 0;
      font-weight: 400;
      color: var(--color-text-table-primary-default);

      i {
        font-weight: 600;
      }
    }
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

  // the icon button is taller than the text and the type icon: all of them are centered
  .typeRow {
    align-items: center;
  }

  .rowAction {
    position: relative;
    margin-left: auto;
    // the button is 24px, the type icon is 20px: the row keeps the height of the others
    margin-block: -2px;
  }

  .loader {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    justify-content: center;
    align-items: center;
  }
</style>
