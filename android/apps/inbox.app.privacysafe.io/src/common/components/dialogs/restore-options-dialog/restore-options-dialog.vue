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
<!--
 Where the user picks between the two rules a restore can follow. Both of them
 are applied by ONE function on this device and on every other one, so what is
 chosen here is what every device of the user will do - see
 applyRestoreSnapshot().
-->
<script lang="ts" setup>
  import { computed, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    Ui3nDialog,
    Ui3nRadio,
    Ui3nRadioGroup,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { skippedAttachmentsLines } from '@common/utils/skipped-attachments';
  import type { RestoreMode } from '@deno/types/sync-types';
  import type { BackupValidationResult } from '@deno/types/backup.types';

  const props = defineProps<{
    validation: BackupValidationResult;
    /** How many messages are in the mailbox right now. */
    currentMessagesCount: number;
    dialogProps?: Ui3nDialogComponentProps<RestoreMode>;
  }>();

  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: RestoreMode }): void;
  }>();

  const { t } = useI18n();

  // `merge` first, and it is the default on purpose: it is the mode that cannot
  // destroy anything, so the destructive one has to be chosen deliberately.
  const mode = ref<RestoreMode>('merge');

  const archivedCount = computed(() => props.validation.messagesCount ?? 0);

  const createdAtText = computed(() => {
    const raw = props.validation.createdAt;
    if (!raw) {
      return t('backup.restore.unknownDate');
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? t('backup.restore.unknownDate') : parsed.toLocaleString();
  });

  const isCompatible = computed(() => props.validation.compatible);

  /**
   * What this archive cannot bring back, named by reason.
   *
   * Shown BEFORE the restore, because afterwards it is too late: a live run
   * ended with a restored message whose small attachment was simply absent, and
   * the only way to find out why was to unpack the archive by hand.
   */
  const skippedLines = computed(() =>
    skippedAttachmentsLines(props.validation.skippedAttachments, t));

  function handleAction(e: { event: Ui3nDialogEvent }) {
    if (e.event === 'confirm') {
      emits('action', { event: 'confirm', data: mode.value });
      return;
    }
    emits('action', e);
  }
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    @action="handleAction"
  >
    <template #body>
      <div :class="$style.body">
        <div :class="$style.summary">
          <div :class="$style.summaryRow">
            <span>{{ t('backup.restore.summary.createdAt') }}</span>
            <b>{{ createdAtText }}</b>
          </div>
          <div :class="$style.summaryRow">
            <span>{{ t('backup.restore.summary.messages') }}</span>
            <b>{{ archivedCount }}</b>
          </div>
          <div :class="$style.summaryRow">
            <span>{{ t('backup.restore.summary.attachments') }}</span>
            <b>{{ validation.attachmentsCount ?? 0 }}</b>
          </div>
          <div :class="$style.summaryRow">
            <span>{{ t('backup.restore.summary.current') }}</span>
            <b>{{ currentMessagesCount }}</b>
          </div>
        </div>

        <div
          v-if="skippedLines.length > 0"
          :class="$style.skipped"
        >
          <span :class="$style.skippedTitle">{{ t('backup.restore.skippedTitle') }}</span>
          <span
            v-for="line in skippedLines"
            :key="line"
          >
            {{ line }}
          </span>
        </div>

        <p
          v-if="!isCompatible"
          :class="$style.compat"
        >
          {{ t('backup.restore.confirmWarningText', {
            archiveVersion: validation.archiveVersion || t('backup.restore.unknownVersion'),
            appVersion: validation.appVersion,
          }) }}
        </p>

        <ui3n-radio-group
          v-model="mode"
          name="restore-mode"
          :class="$style.modes"
        >
          <ui3n-radio
            :checked-value="'merge'"
            :class="$style.mode"
          >
            <div :class="$style.modeText">
              <span :class="$style.modeName">{{ t('backup.restore.mode.mergeTitle') }}</span>
              <span :class="$style.modeHint">{{ t('backup.restore.mode.mergeHint') }}</span>
            </div>
          </ui3n-radio>

          <ui3n-radio
            :checked-value="'replace'"
            :class="$style.mode"
          >
            <div :class="$style.modeText">
              <span :class="$style.modeName">{{ t('backup.restore.mode.replaceTitle') }}</span>
              <span :class="$style.modeHint">{{ t('backup.restore.mode.replaceHint') }}</span>
            </div>
          </ui3n-radio>
        </ui3n-radio-group>

        <p
          v-if="mode === 'replace'"
          :class="$style.danger"
        >
          {{ t('backup.restore.mode.replaceWarning') }}
        </p>

        <p :class="$style.notice">
          {{ t('backup.restore.devicesNotice') }}
        </p>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .body {
    position: relative;
    display: flex;
    flex-direction: column;
    row-gap: var(--spacing-s);
    padding: var(--spacing-ml) var(--spacing-m) var(--spacing-s);
    font-size: var(--font-14);
    color: var(--color-text-block-primary-default);
  }

  .summary {
    display: flex;
    flex-direction: column;
    row-gap: var(--spacing-xs);
    padding: var(--spacing-s);
    border-radius: var(--spacing-xs);
    background-color: var(--color-bg-block-secondary-default);
    font-size: var(--font-12);
  }

  .summaryRow {
    display: flex;
    justify-content: space-between;
    column-gap: var(--spacing-s);
    color: var(--color-text-block-secondary-default);

    b {
      color: var(--color-text-block-primary-default);
    }
  }

  .skipped {
    display: flex;
    flex-direction: column;
    row-gap: 2px;
    padding: var(--spacing-s);
    border-radius: var(--spacing-xs);
    background-color: var(--color-bg-block-secondary-default);
    font-size: var(--font-12);
    line-height: var(--font-16);
    color: var(--warning-content-default);
  }

  .skippedTitle {
    font-weight: 600;
  }

  .compat {
    margin: 0;
    font-size: var(--font-12);
    line-height: var(--font-16);
    color: var(--warning-content-default);
  }

  .modes {
    row-gap: var(--spacing-s);
  }

  .mode {
    align-items: flex-start;
  }

  .modeText {
    display: flex;
    flex-direction: column;
    row-gap: 2px;
  }

  .modeName {
    font-size: var(--font-13);
    font-weight: 600;
  }

  .modeHint {
    font-size: var(--font-12);
    line-height: var(--font-16);
    color: var(--color-text-block-secondary-default);
  }

  .danger {
    margin: 0;
    font-size: var(--font-12);
    line-height: var(--font-16);
    color: var(--error-content-default);
  }

  .notice {
    margin: 0;
    font-size: var(--font-12);
    line-height: var(--font-16);
    color: var(--color-text-block-secondary-default);
  }
</style>
