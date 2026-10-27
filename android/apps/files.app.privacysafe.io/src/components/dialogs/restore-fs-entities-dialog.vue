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
  import size from 'lodash/size';
  import {
    Ui3nButton,
    Ui3nDialog,
    type Ui3nDialogEvent,
    type Ui3nDialogComponentProps,
  } from '@v1nt1248/3nclient-lib';

  const props = withDefaults(
    defineProps<{
      entityNames?: string[];
      dialogProps?: Ui3nDialogComponentProps<'keep' | 'replace'>;
    }>(),
    {
      entityNames: () => [],
      dialogProps: () => ({}),
    },
  );
  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: 'keep' | 'replace' }): void;
  }>();

  const { t } = useI18n();

  const mainText = computed(() =>
    t(
      'dialog.restore.text',
      { name: size(props.entityNames) > 1 ? props.entityNames.join(', ') : props.entityNames[0] },
      size(props.entityNames),
    ),
  );

  const questionText = computed(() => t('dialog.restore.question', size(props.entityNames) === 1 ? 1 : 2));

  function processClick(action: 'keep' | 'replace') {
    emits('action', { event: 'confirm', data: action });
  }
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    @action="emits('action', $event)"
  >
    <template #body>
      <div :class="$style.restoreFsEntitiesDialog">
        {{ mainText }}

        <span>{{ questionText }}</span>
      </div>
    </template>

    <template #actions>
      <div :class="$style.dialogActions">
        <ui3n-button
          type="secondary"
          @click.stop.prevent="emits('action', { event: 'close' })"
        >
          {{ t('dialog.button.cancel') }}
        </ui3n-button>

        <div :class="$style.actionsBlock">
          <ui3n-button
            type="secondary"
            @click.stop.prevent="processClick('keep')"
          >
            {{ t('fs.entity.button.restore_keep') }}
          </ui3n-button>

          <ui3n-button @click.stop.prevent="processClick('replace')">
            {{ t('fs.entity.button.restore_replace') }}
          </ui3n-button>
        </div>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .restoreFsEntitiesDialog {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    row-gap: var(--spacing-s);
    padding: var(--spacing-m);
    font-size: var(--font-14);
    line-height: var(--font-20);
    font-weight: 400;
    color: var(--color-text-block-primary-default);
    text-align: center;
  }

  .dialogActions {
    display: flex;
    width: 100%;
    padding: var(--spacing-m);
    justify-content: space-between;
    align-items: center;
  }

  .actionsBlock {
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-s);
  }
</style>
