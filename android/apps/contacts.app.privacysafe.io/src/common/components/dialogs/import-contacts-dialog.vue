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
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    Ui3nButton,
    Ui3nCheckbox,
    Ui3nDialog,
    Ui3nProgressLinear,
    Ui3nRadio,
    Ui3nRadioGroup,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { useContactsImport, type ImportOutcome, type ImportStats } from '@main/common/composables/use-contacts-import';
  import {
    IMPORT_FIELDS,
    type ImportField,
    type ImportFieldSource,
  } from '@main/common/utils/contacts-import';

  export interface ImportContactsResult {
    outcome: ImportOutcome;
    stats: ImportStats;
  }

  const props = defineProps<{
    importId: string;
    dialogProps?: Ui3nDialogComponentProps<ImportContactsResult>;
  }>();

  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: ImportContactsResult }): void;
  }>();

  const { t } = useI18n();

  const { total, processed, percent, stats, conflict, run, decide, abort } = useContactsImport(props.importId);

  const FIELD_LABELS: Record<ImportField, string> = {
    avatar: 'import.field.avatar',
    name: 'contact.content.name',
    phone: 'contact.content.phone',
    notice: 'contact.content.note',
  };

  /** Choosing by fields: the table gets radio buttons, and "Apply" appears. */
  const isChoosingByFields = ref(false);
  const applyToAll = ref(false);
  const fieldSources = ref<Record<ImportField, ImportFieldSource>>(defaultSources());

  function defaultSources(): Record<ImportField, ImportFieldSource> {
    return { avatar: 'current', name: 'current', phone: 'current', notice: 'current' };
  }

  watch(conflict, () => {
    isChoosingByFields.value = false;
    fieldSources.value = defaultSources();
  });

  const rows = computed(() => {
    const value = conflict.value;
    if (!value) {
      return [];
    }

    const { existing, incoming, fields } = value;
    return IMPORT_FIELDS.map(field => ({
      field,
      label: t(FIELD_LABELS[field]),
      current: (field === 'avatar') ? existing.avatarImage || '' : existing[field] || '',
      incoming: (field === 'avatar') ? incoming.avatarImage || '' : incoming[field] || '',
      isDifferent: fields.includes(field),
    }));
  });

  function keepCurrent() {
    decide({ kind: 'keep' }, applyToAll.value);
  }

  function takeIncoming() {
    decide({ kind: 'incoming' }, applyToAll.value);
  }

  function applyFieldChoice() {
    decide({ kind: 'fields', fields: { ...fieldSources.value } });
  }

  function handleAction(e: { event: Ui3nDialogEvent }) {
    if ((e.event === 'cancel') || (e.event === 'close')) {
      abort();
    }
  }

  // Started as the dialog is set up; the dialog closes itself at the end.
  run()
    .then(outcome => emits('action', { event: 'close', data: { outcome, stats: { ...stats.value } } }))
    .catch(async err => {
      await w3n.log('error', 'Error while importing contacts', err);
      emits('action', { event: 'close', data: { outcome: 'aborted', stats: { ...stats.value } } });
    });
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    @action="handleAction"
  >
    <template #body>
      <div :class="$style.body">
        <div :class="$style.info">
          <span :class="$style.text">
            {{ t('import.progress', { number: processed, total }) }}
          </span>
          <span :class="$style.value">{{ `${percent}%` }}</span>
        </div>

        <ui3n-progress-linear
          bg-color="transparent"
          height="4"
          :value="percent"
        />

        <div
          v-if="conflict"
          :class="$style.conflict"
        >
          <div :class="$style.conflictTitle">
            {{ t('import.conflict.title', { mail: conflict.existing.mail }) }}
          </div>

          <div :class="$style.table">
            <div :class="$style.headCell" />
            <div :class="$style.headCell">
              {{ t('import.conflict.current') }}
            </div>
            <div :class="$style.headCell">
              {{ t('import.conflict.incoming') }}
            </div>

            <template
              v-for="row in rows"
              :key="row.field"
            >
              <div :class="[$style.labelCell, !row.isDifferent && $style.same]">
                {{ row.label }}
              </div>

              <ui3n-radio-group
                v-if="isChoosingByFields && row.isDifferent"
                v-model="fieldSources[row.field]"
                :name="`import-${row.field}`"
                :class="$style.rowGroup"
              >
                <div
                  v-for="source in (['current', 'incoming'] as const)"
                  :key="source"
                  :class="$style.cell"
                >
                  <ui3n-radio
                    :checked-value="source"
                    :size="16"
                  >
                    <img
                      v-if="row.field === 'avatar' && row[source]"
                      :src="row[source]"
                      :class="$style.avatar"
                      alt=""
                    />
                    <span
                      v-else
                      :class="[$style.cellText, !row[source] && $style.empty]"
                    >
                      {{ row[source] || t('import.conflict.empty') }}
                    </span>
                  </ui3n-radio>
                </div>
              </ui3n-radio-group>

              <template v-else>
                <div
                  v-for="source in (['current', 'incoming'] as const)"
                  :key="source"
                  :class="[$style.cell, !row.isDifferent && $style.same]"
                >
                  <img
                    v-if="row.field === 'avatar' && row[source]"
                    :src="row[source]"
                    :class="$style.avatar"
                    alt=""
                  />
                  <span
                    v-else
                    :class="[$style.cellText, !row[source] && $style.empty]"
                  >
                    {{ row[source] || t('import.conflict.empty') }}
                  </span>
                </div>
              </template>
            </template>
          </div>

          <ui3n-checkbox
            v-if="!isChoosingByFields"
            v-model="applyToAll"
            :size="16"
          >
            <span :class="$style.checkboxLabel">{{ t('import.conflict.applyToAll') }}</span>
          </ui3n-checkbox>

          <div :class="$style.decisions">
            <template v-if="!isChoosingByFields">
              <ui3n-button
                type="secondary"
                @click="keepCurrent"
              >
                {{ t('import.btn.keep') }}
              </ui3n-button>
              <ui3n-button
                type="secondary"
                @click="takeIncoming"
              >
                {{ t('import.btn.incoming') }}
              </ui3n-button>
              <ui3n-button
                type="primary"
                @click="isChoosingByFields = true"
              >
                {{ t('import.btn.byFields') }}
              </ui3n-button>
            </template>

            <ui3n-button
              v-else
              type="primary"
              @click="applyFieldChoice"
            >
              {{ t('import.btn.apply') }}
            </ui3n-button>
          </div>
        </div>
      </div>
    </template>

    <template #actions>
      <div :class="$style.actions">
        <ui3n-button
          type="custom"
          color="var(--color-bg-block-primary-default)"
          text-color="var(--color-text-button-secondary-default)"
          @click="abort"
        >
          {{ t('import.btn.abort') }}
        </ui3n-button>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .body {
    position: relative;
    width: 100%;
    color: var(--color-text-block-primary-default);
    padding: var(--spacing-ml) var(--spacing-m);
    display: flex;
    flex-direction: column;
    row-gap: var(--spacing-s);
  }

  .info {
    display: flex;
    width: 100%;
    height: var(--spacing-m);
    justify-content: space-between;
    align-items: center;
    font-size: var(--font-12);
    color: var(--color-text-control-primary-default);
  }

  .text {
    display: inline-block;
    padding-left: var(--spacing-s);
    font-weight: 400;
  }

  .value {
    padding-right: var(--spacing-s);
    font-weight: 600;
  }

  .conflict {
    display: flex;
    flex-direction: column;
    row-gap: var(--spacing-m);
    padding-top: var(--spacing-m);
  }

  .conflictTitle {
    font-size: var(--font-14);
    font-weight: 600;
    color: var(--color-text-block-primary-default);
    word-break: break-all;
  }

  .table {
    display: grid;
    grid-template-columns: minmax(80px, max-content) minmax(0, 1fr) minmax(0, 1fr);
    color: var(--color-text-table-primary-default);
    background-color: var(--color-bg-table-cell-default);
    border: 1px solid var(--color-border-table-primary-default);
    border-radius: 8px;
    overflow: hidden;
  }

  // The group's own element is left out of the layout, so that its radios
  // take the cells of the row.
  .rowGroup {
    display: contents !important;
  }

  .headCell,
  .labelCell,
  .cell {
    padding: var(--spacing-s);
    font-size: var(--font-12);
    border-bottom: 1px solid var(--color-border-table-primary-default);
    min-width: 0;
  }

  .headCell {
    font-weight: 600;
    color: var(--color-text-table-primary-default);
    background-color: var(--color-bg-table-header-default);
  }

  .labelCell {
    font-weight: 600;
    color: var(--color-text-table-primary-default);
  }

  .cell {
    display: flex;
    align-items: center;
  }

  .cellText {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .same {
    opacity: 0.6;
  }

  .empty {
    font-style: italic;
    color: var(--color-text-table-secondary-default);
  }

  .avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
  }

  .checkboxLabel {
    font-size: var(--font-12);
    color: var(--color-text-block-primary-default);
  }

  .decisions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--spacing-s);
  }

  .actions {
    display: flex;
    width: 100%;
    height: 64px;
    padding: 0 var(--spacing-m);
    justify-content: flex-end;
    align-items: center;
  }
</style>
