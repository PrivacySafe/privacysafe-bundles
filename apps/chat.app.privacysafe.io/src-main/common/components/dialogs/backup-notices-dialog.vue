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
<script lang="ts" setup>
  import { useI18n } from 'vue-i18n';
  import { Ui3nDialog, type Ui3nDialogComponentProps, type Ui3nDialogEvent } from '@v1nt1248/3nclient-lib';

  defineProps<{
    dialogProps?: Ui3nDialogComponentProps<boolean>;
  }>();

  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent }): void;
  }>();

  const { t } = useI18n();

  /**
   * The boundary of what an archive can ever bring back.
   *
   * A stop of its own, and not a paragraph under a progress bar: these used to
   * live in the creating dialog, where the whole of a small backup can pass in
   * under a second - long enough to see that something was written, and not
   * long enough to read it. They are also said now rather than in half a year,
   * at the moment the archive is needed.
   */
  const NOTICE_KEYS = [
    'backup.create.attachmentsNotice',
    'backup.create.thisDeviceNotice',
    'backup.create.bigFilesNotice',
    'backup.create.autoDeleteNotice',
  ];
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    @action="emits('action', $event)"
  >
    <template #body>
      <div :class="$style.body">
        <ul :class="$style.list">
          <li
            v-for="key in NOTICE_KEYS"
            :key="key"
            :class="$style.notice"
          >
            {{ t(key) }}
          </li>
        </ul>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .body {
    position: relative;
    width: 100%;
    padding: var(--spacing-ml) var(--spacing-m);
  }

  .list {
    margin: 0;
    padding-left: var(--spacing-m);
    display: flex;
    flex-direction: column;
    row-gap: var(--spacing-s);
  }

  .notice {
    font-size: var(--font-12);
    line-height: var(--font-16);
    color: var(--color-text-block-primary-default);
  }
</style>
