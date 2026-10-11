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
  import {
    Ui3nButton,
    Ui3nDialog,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { useReportCreation } from '@common/composables/useReportCreation';
  import type { IncomingMessageView } from '@common/types';
  import ReportData from '@common/components/dialogs/report-dialog/report-data.vue';
  import ReportCompose from '@common/components/dialogs/report-dialog/report-compose.vue';

  const props = defineProps<{
    message: IncomingMessageView;
    dialogProps?: Ui3nDialogComponentProps<string>;
  }>();

  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: string }): void;
  }>();

  const { t } = useI18n();

  const {
    step,
    reportAddress,
    reasons,
    includeMessage,
    includeAttachments,
    additionalDetails,
    shouldBlockContact,
    isSending,
    hasAttachments,
    actionBtnText,
    disableActionBtn,
    onFieldUpdate,
    runAction,
    stepBack,
  } = useReportCreation(() => props.message, {
    onSent: reportMsgId => emits('action', { event: 'confirm', data: reportMsgId }),
    onNoReportAddress: () => emits('action', { event: 'close' }),
  });
</script>

<template>
  <ui3n-dialog
    v-bind="{
      ...dialogProps,
      title: t('dialog.report-dialog.title'),
      icon: { icon: 'outline-report-problem', color: 'var(--warning-content-default)' },
      cssStyle: { width: '95vw', maxWidth: '640px' },
      confirmButton: false,
      cancelButton: false,
    }"
    @action="ev => emits('action', ev)"
  >
    <template #body>
      <div :class="$style.reportDialog">
        <report-data
          v-if="step === 1"
          :has-attachments="hasAttachments"
          :reasons="reasons"
          :include-message="includeMessage"
          :include-attachments="includeAttachments"
          @update:field="onFieldUpdate"
        />

        <report-compose
          v-if="step === 2"
          :report-address="reportAddress!"
          :message="message"
          :reasons="reasons"
          :additional-details="additionalDetails"
          :should-block-contact="shouldBlockContact"
          :include-message="includeMessage"
          :include-attachments="includeAttachments"
          @update:field="onFieldUpdate"
        />
      </div>
    </template>

    <template #actions>
      <div :class="$style.actions">
        <div :class="$style.btnBlock">
          <ui3n-button
            type="secondary"
            @click.stop.prevent="emits('action', { event: 'cancel' })"
          >
            {{ t('app.btn.cancel') }}
          </ui3n-button>

          <ui3n-button
            v-if="step > 1"
            type="outline"
            :disabled="isSending"
            @click.stop.prevent="() => stepBack()"
          >
            {{ t('app.btn.back') }}
          </ui3n-button>
        </div>

        <ui3n-button
          :disabled="disableActionBtn"
          @click.stop.prevent="() => runAction()"
        >
          {{ actionBtnText }}
        </ui3n-button>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .reportDialog {
    width: 100%;
    height: calc(100dvh - 152px);
    padding: var(--spacing-m);
  }

  .actions {
    display: flex;
    width: 100%;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-m);
  }

  .btnBlock {
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-m);
  }
</style>
