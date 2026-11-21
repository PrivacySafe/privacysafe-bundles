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

 The numbers under each mode come from previewRestore(), a dry run over the
 archive that writes nothing: `replace` deletes whole chats, history and all,
 and that is not a thing to confirm on a description alone.
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
    type Ui3nRadioValue,
  } from '@v1nt1248/3nclient-lib';
  import { skippedAttachmentsLines } from '@main/common/utils/skipped-attachments';
  import type { BackupValidationResult, RestoreMode, RestorePreview } from '~/backup.types';

  const props = defineProps<{
    validation: BackupValidationResult;
    /** What each mode would do, as a dry run over the archive found it. */
    preview: { merge: RestorePreview; replace: RestorePreview };
    /** How many chats there are right now. */
    currentChatsCount: number;
    dialogProps?: Ui3nDialogComponentProps<RestoreMode>;
  }>();

  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: RestoreMode }): void;
  }>();

  const { t } = useI18n();

  // `merge` first, and it is the default on purpose: it is the mode that cannot
  // destroy anything, so the destructive one has to be chosen deliberately.
  //
  // The radio group speaks in Ui3nRadioValue (a bare string), so the narrowing
  // to RestoreMode happens here rather than being asserted: anything but
  // 'replace' reads as the mode that can destroy nothing, which is the safe way
  // round for a value that comes out of a component's typing.
  const chosen = ref<Ui3nRadioValue>('merge');
  const mode = computed<RestoreMode>(() => (chosen.value === 'replace') ? 'replace' : 'merge');

  const chosenPreview = computed(() =>
    (mode.value === 'replace') ? props.preview.replace : props.preview.merge);

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
   * Shown BEFORE the restore, because afterwards it is too late: finding out by
   * unpacking the archive by hand is finding out too late.
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
            <span>{{ t('backup.restore.summary.chats') }}</span>
            <b>{{ validation.chatsCount ?? 0 }}</b>
          </div>
          <div :class="$style.summaryRow">
            <span>{{ t('backup.restore.summary.messages') }}</span>
            <b>{{ validation.messagesCount ?? 0 }}</b>
          </div>
          <div :class="$style.summaryRow">
            <span>{{ t('backup.restore.summary.attachments') }}</span>
            <b>{{ validation.attachmentsCount ?? 0 }}</b>
          </div>
          <div :class="$style.summaryRow">
            <span>{{ t('backup.restore.summary.currentChats') }}</span>
            <b>{{ currentChatsCount }}</b>
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
          v-model="chosen"
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

        <div :class="$style.summary">
          <div :class="$style.summaryRow">
            <span>{{ t('backup.restore.summary.toCreate') }}</span>
            <b>{{ chosenPreview.chatsToCreate + chosenPreview.messagesToCreate }}</b>
          </div>
          <div :class="$style.summaryRow">
            <span>{{ t('backup.restore.summary.toUpdate') }}</span>
            <b>{{ chosenPreview.chatsToUpdate + chosenPreview.messagesToUpdate }}</b>
          </div>
          <div :class="[$style.summaryRow, mode === 'replace' && $style.dangerRow]">
            <span>{{ t('backup.restore.summary.toDelete') }}</span>
            <b>{{ chosenPreview.chatsToDelete + chosenPreview.messagesToDelete }}</b>
          </div>
          <div
            v-if="chosenPreview.expiredSkipped > 0"
            :class="$style.summaryRow"
          >
            <span>{{ t('backup.restore.summary.expiredSkipped') }}</span>
            <b>{{ chosenPreview.expiredSkipped }}</b>
          </div>
        </div>

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

  .dangerRow {
    b {
      color: var(--error-content-default);
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
