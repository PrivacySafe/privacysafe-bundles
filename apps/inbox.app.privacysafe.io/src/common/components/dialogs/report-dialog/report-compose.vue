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
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Ui3nCheckbox, Ui3nHtml, Ui3nText } from '@v1nt1248/3nclient-lib';
  import type { IncomingMessageView } from '@common/types';
  import { formatReportedMsgDate, reasonsToText } from './prepare-report-body';
  import AddressChip from '@common/components/address-chip/address-chip.vue';

  const vUi3nHtml = Ui3nHtml;

  // Everything shown here is owned by the dialog, for the same reason as in
  // report-data.vue: the steps are rendered with v-if, and a value kept here
  // would not survive a step back and forward again.
  const props = defineProps<{
    reportAddress: string;
    message: IncomingMessageView;
    reasons: string[];
    additionalDetails: string;
    shouldBlockContact: boolean;
    includeMessage: boolean;
    includeAttachments: boolean;
  }>();

  const emits = defineEmits<{
    (
      event: 'update:field',
      payload: { field: 'details'; value: string } | { field: 'block'; value: boolean },
    ): void;
  }>();

  const { t } = useI18n();

  const reasonsText = computed(() => reasonsToText(props.reasons, t));

  const receivedAt = computed(() => formatReportedMsgDate(props.message));

  // What the message carries, whether or not it is attached: the list below is
  // only drawn when the user asked for the attachments to go with the report.
  const attachmentNames = computed(() => (props.message.attachmentsInfo || []).map(item => item.fileName));

  const withAttachmentsList = computed(() => props.includeAttachments && attachmentNames.value.length > 0);

  const quotedBody = computed(() => props.message.htmlTxtBody || props.message.plainTxtBody || '');
</script>

<template>
  <div :class="$style.reportCompose">
    <h4 :class="$style.subtitle">
      {{ t('dialog.report-dialog.content.step2SubTitle') }}
    </h4>

    <div :class="$style.row">
      <div :class="$style.label">
        {{ t('msg.create.label.to') }}:
      </div>

      <address-chip
        :address="reportAddress"
        :disabled="true"
      />
    </div>

    <div :class="[$style.row, $style.offset]">
      <div :class="$style.label">
        {{ t('msg.create.label.subject') }}:
      </div>

      <div :class="$style.text">
        {{ t('msg.create.report.subject') }}
      </div>
    </div>

    <div :class="$style.row">
      <span :class="$style.text">
        {{ t('dialog.report-dialog.content.step2Preamble') }}
      </span>
    </div>

    <div :class="$style.row">
      <div :class="$style.text">
        {{ t('dialog.report-dialog.content.reason.label') }}:
      </div>

      <span :class="$style.text">{{ reasonsText }}</span>
    </div>

    <!-- Who is being reported goes into the report whatever the toggles say,
         so it is shown here whatever they say too. -->
    <div :class="$style.row">
      <div :class="$style.text">
        {{ t('dialog.report-dialog.content.reportedSender') }}:
      </div>

      <span :class="$style.text">{{ message.sender }}</span>
    </div>

    <div :class="[$style.row, $style.offset]">
      <div :class="$style.text">
        {{ t('dialog.report-dialog.content.reportedReceivedAt') }}:
      </div>

      <span :class="$style.text">{{ receivedAt }}</span>
    </div>

    <div :class="[$style.text, $style.offset]">
      {{ t('dialog.report-dialog.content.step2Additional') }}:
    </div>

    <ui3n-text
      :model-value="additionalDetails"
      :rows="6"
      :max-rows="10"
      @update:model-value="v => emits('update:field', { field: 'details', value: v })"
    />

    <div
      v-if="includeMessage"
      :class="$style.quoteBlock"
    >
      <div :class="$style.label">
        ---------- {{ t('dialog.report-dialog.content.reportedMessageTitle') }} ----------
      </div>

      <div :class="$style.text">
        {{ t('msg.create.label.from') }}: {{ message.sender }}
      </div>

      <div :class="$style.text">
        {{ t('msg.create.label.subject') }}: {{ message.subject }}
      </div>

      <blockquote
        v-ui3n-html="quotedBody"
        :class="$style.quote"
      />
    </div>

    <div
      v-if="withAttachmentsList"
      :class="$style.offset"
    >
      <div :class="$style.text">
        {{ t('dialog.report-dialog.content.attachmentsNote') }}
      </div>

      <ul :class="$style.attachments">
        <li
          v-for="name in attachmentNames"
          :key="name"
          :class="$style.text"
        >
          {{ name }}
        </li>
      </ul>
    </div>

    <div :class="$style.row">
      <span :class="$style.label">
        {{ t('dialog.report-dialog.content.step2Block') }}
      </span>

      <ui3n-checkbox
        size="24"
        :model-value="shouldBlockContact"
        @update:model-value="v => emits('update:field', { field: 'block', value: v as boolean })"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .reportCompose {
    position: relative;
    width: 100%;
    height: 100%;
    color: var(--color-text-block-primary-default);
  }

  .subtitle {
    font-size: 14px;
    font-weight: 600;
    text-align: center;
    margin: 0 0 var(--spacing-s) 0;
  }

  .row {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    margin-bottom: var(--spacing-s);
    color: var(--color-text-control-primary-default);

    &.offset {
      margin-bottom: var(--spacing-ml);
    }
  }

  .label {
    font-size: var(--font-14);
    font-weight: 600;
  }

  .text {
    font-size: var(--font-14);

    &.offset {
      margin-bottom: var(--spacing-s);
    }
  }

  .quoteBlock {
    margin-bottom: var(--spacing-ml);
  }

  .quote {
    margin: var(--spacing-s) 0 0 0;
    padding-left: var(--spacing-s);
    border-left: 2px solid var(--color-border-control-secondary-default);
    font-size: var(--font-14);
    overflow-wrap: anywhere;
  }

  .attachments {
    margin: var(--spacing-xs) 0 0 0;
    padding-left: var(--spacing-ml);
  }

  [data-ui3n="text"] {
    margin-bottom: var(--spacing-ml);
  }
</style>
