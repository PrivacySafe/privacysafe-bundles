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
<script setup lang="ts">
  import { useI18n } from 'vue-i18n';
  import dayjs from 'dayjs';
  import { type Nullable, Ui3nButton, Ui3nIcon, Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
  import { formatFileSize } from '@v1nt1248/3nclient-lib/utils';
  import type { ListingEntryExtended } from '@shared/types';
  import FileType from '@/components/common/file-type/file-type.vue';

  const UPDATE_DATE_FORMAT = 'YYYY-MM-DD HH:mm:ss';

  defineProps<{
    branch: 'local' | 'cloud';
    stats: Nullable<ListingEntryExtended & { thumbnail?: string }> | undefined;
    parentFolder: Nullable<string>;
    short?: boolean;
  }>();
  const emits = defineEmits<{
    (event: 'open'): void;
  }>();

  const { t } = useI18n();
</script>

<template>
  <div :class="[$style.block, short && $style.blockShort]">
    <template v-if="stats">
      <div :class="$style.header">
        <ui3n-icon
          :icon="branch === 'cloud' ? 'round-cloud' : 'hard-drive'"
          color="var(--color-icon-control-secondary-default)"
        />

        <div :class="$style.title">
          {{ branch === 'cloud' ? t('dialog.resolve.cloud_text') : t('dialog.resolve.local_text') }}
        </div>

        <div :class="$style.updateDate">
          {{ dayjs(stats?.mtime).format(UPDATE_DATE_FORMAT) }}
        </div>
      </div>

      <div :class="$style.data">
        <div :class="$style.info">
          <div :class="[$style.entity, short && $style.entityShort]">
            <ui3n-icon
              :class="$style.iconType"
              :icon="stats?.type === 'folder' ? 'round-folder' : 'round-subject'"
              color="var(--color-icon-table-secondary-default)"
            />

            <div :class="$style.name">
              <span>
                <template v-if="short"> {{ parentFolder }} / </template>
                {{ stats?.name }}
              </span>
            </div>

            <div :class="$style.type">
              <file-type
                v-if="stats?.type !== 'folder'"
                :file-type="stats?.ext || ''"
              />

              <span v-else />
            </div>

            <div :class="$style.size">
              {{ stats?.size ? formatFileSize(stats.size) : '' }}
            </div>
          </div>

          <div
            v-if="!short"
            :class="$style.entityFolder"
          >
            {{ parentFolder }}
          </div>
        </div>

        <ui3n-button
          v-if="stats?.type !== 'folder'"
          type="custom"
          color="var(--color-bg-button-tritery-default)"
          text-color="var(--color-text-button-titery-default)"
          :disable="true"
          @click.stop.prevent="emits('open')"
        >
          {{ t('app.open') }}
        </ui3n-button>
      </div>
    </template>

    <div
      v-else
      :class="$style.loader"
    >
      <ui3n-progress-circular
        size="80"
        indeterminate
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .block {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: stretch;
    width: 100%;
    height: 100%;
    padding: 0 var(--spacing-m);
    row-gap: var(--spacing-s);

    &.blockShort {
      padding: 0 0 0 var(--spacing-s);
      row-gap: var(--spacing-xs);
    }
  }

  .header {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    color: var(--color-text-control-primary-default);
  }

  .title {
    font-size: var(--font-13);
    line-height: var(--font-20);
    font-weight: 500;
  }

  .updateDate {
    font-size: var(--font-13);
    line-height: var(--font-20);
    font-weight: 400;
  }

  .data {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    column-gap: var(--spacing-s);
  }

  .info {
    position: relative;
    flex-grow: 1;
    color: var(--color-text-control-primary-default);
  }

  .entity {
    display: flex;
    width: 100%;
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-xs);
    margin-bottom: var(--spacing-xs);

    &.entityShort {
      column-gap: var(--spacing-s);
      margin-bottom: 0;
    }
  }

  .iconType {
    position: relative;
    height: var(--spacing-m);
    min-width: var(--spacing-m);
  }

  .name {
    flex-grow: 1;
    font-size: var(--font-12);
    line-height: var(--font-16);
    font-weight: 400;
  }

  .type {
    position: relative;
    height: var(--spacing-m);
    width: 48px;
    min-width: 48px;
  }

  .size {
    position: relative;
    height: var(--spacing-m);
    width: 80px;
    min-width: 80px;
  }

  .entityFolder {
    position: relative;
    padding-left: var(--spacing-ml);
    font-size: var(--font-10);
    line-height: var(--font-12);
  }

  .loader {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
  }
</style>
