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
  import { Ui3nButton } from '@v1nt1248/3nclient-lib';
  import { useReportCreation } from '@common/composables/useReportCreation';
  import type { IncomingMessageView } from '@common/types';
  import ReportData from '@common/components/dialogs/report-dialog/report-data.vue';
  import ReportCompose from '@common/components/dialogs/report-dialog/report-compose.vue';

  const props = defineProps<{
    message: IncomingMessageView;
  }>();

  const emits = defineEmits<{
    (event: 'close'): void;
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
    hasAttachments,
    disableActionBtn,
    onFieldUpdate,
    runAction,
    stepBack,
  } = useReportCreation(() => props.message, {
    onSent: () => emits('close'),
    onNoReportAddress: () => emits('close'),
  });

  function onBack() {
    if (step.value > 1) {
      stepBack();
      return;
    }

    emits('close');
  }
</script>

<template>
  <div :class="$style.reportForm">
    <div :class="$style.toolbar">
      <ui3n-button
        type="icon"
        size="large"
        color="var(--color-bg-block-primary-default)"
        icon="round-arrow-back"
        icon-color="var(--color-icon-block-primary-default)"
        icon-size="24"
        @click="onBack()"
      />

      <span :class="$style.title">
        {{ t('dialog.report-dialog.pageTitle') }}
      </span>

      <ui3n-button
        type="icon"
        size="large"
        color="var(--color-bg-block-primary-default)"
        icon="round-send"
        icon-color="var(--color-icon-block-primary-default)"
        icon-size="24"
        :disabled="disableActionBtn"
        @click="runAction()"
      />
    </div>

    <div :class="$style.body">
      <div :class="$style.bodyContent">
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
    </div>
  </div>
</template>

<style lang="scss" module>
  .reportForm {
    --report-toolbar-height: 64px;

    position: relative;
    width: 100%;
    height: 100%;
  }

  .toolbar {
    display: flex;
    width: 100%;
    height: var(--report-toolbar-height);
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-s);
    padding: 0 var(--spacing-s);
    border-bottom: 1px solid var(--color-border-block-primary-default);
  }

  .title {
    flex-grow: 1;
    font-size: var(--font-16);
    font-weight: 600;
    color: var(--color-text-block-primary-default);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .body {
    position: relative;
    width: 100%;
    height: calc(100% - var(--report-toolbar-height));
    overflow-x: hidden;
    overflow-y: auto;
  }

  .bodyContent {
    padding: var(--spacing-m);
  }
</style>
