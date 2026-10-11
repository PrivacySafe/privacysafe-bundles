<!--
 Copyright (C) 2026 3NSoft Inc.

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
  import { Ui3nButton, Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
  import { formatFileSize } from '@v1nt1248/3nclient-lib/utils';
  import type { ReadProgress } from '@main/common/utils/read-with-progress';

  defineProps<{
    /** Reading the file, so there is a size to measure against. */
    reading: boolean;
    percent: number;
    progress: ReadProgress;
  }>();

  const emits = defineEmits<{
    (event: 'cancel'): void;
  }>();

  const { t } = useI18n();
</script>

<template>
  <div :class="$style.loading">
    <!-- Determinate only while the file is being read: what happens after it -
         decoding, rendering a frame - has nothing to measure. -->
    <ui3n-progress-circular
      v-if="reading"
      :value="percent"
      with-text
      size="108"
    />

    <ui3n-progress-circular
      v-else
      indeterminate
      size="108"
    />

    <div
      v-if="reading && progress.total > 0"
      :class="$style.read"
    >
      {{ t('chat.viewer.label.loading', {
        done: formatFileSize(progress.done),
        total: formatFileSize(progress.total),
      }) }}
    </div>

    <ui3n-button
      v-if="reading"
      type="secondary"
      @click.stop.prevent="emits('cancel')"
    >
      {{ t('chat.viewer.btn.cancel_loading') }}
    </ui3n-button>
  </div>
</template>

<style lang="scss" module>
  .loading {
    position: absolute;
    inset: 0;
    z-index: 5500;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    row-gap: var(--spacing-m);
    pointer-events: none;

    button {
      pointer-events: auto;
    }
  }

  .read {
    font-size: var(--font-13);
    font-weight: 500;
    color: var(--color-text-block-primary-default);
  }
</style>
