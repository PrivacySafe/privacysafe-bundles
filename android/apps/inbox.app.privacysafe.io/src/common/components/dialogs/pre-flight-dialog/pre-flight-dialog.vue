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
<script lang="ts" setup>
  import { onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import isEmpty from 'lodash/isEmpty';
  import { Ui3nDialog, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import { useCreateMsgActions } from '@common/composables/useCreateMsgActions';
  import { prepareErrorText } from '@/common/utils';
  import type { PreFlightDialogProps, PreFlightDialogEmits } from './types';
  import ContactIcon from '@common/components/contact-icon/contact-icon.vue';

  const props = defineProps<PreFlightDialogProps>();
  const emits = defineEmits<PreFlightDialogEmits>();

  const { t } = useI18n();
  const { runPreFlightProcess } = useCreateMsgActions();

  const isLoading = ref(false);
  const _recipientsVerificationResult = ref<Record<string, number | string | null>>({});
  const _unavailableRecipients = ref<Record<string, string>>({});

  function getVerificationResult(recipient: string, errorFlag: string): string {
    return prepareErrorText({ t, address: recipient, errorFlag });
  }

  onMounted(async () => {
    try {
      isLoading.value = true;

      const { recipientsVerificationResult, unavailableRecipients } = await runPreFlightProcess(props.msgData);
      _recipientsVerificationResult.value = recipientsVerificationResult;
      _unavailableRecipients.value = unavailableRecipients;
      isLoading.value = false;

      if (isEmpty(_unavailableRecipients.value)) {
        emits('action', { event: 'confirm', data: _unavailableRecipients.value });
        return;
      }
    } finally {
      isLoading.value = false;
    }
  });
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    :data="_unavailableRecipients"
    :is-valid="!isLoading"
    @action="emits('action', $event)"
  >
    <template #body>
      <div :class="$style.preFlightDialog">
        <template v-if="isLoading">
          <div :class="$style.text">
            {{ t('msg.preflight_dialog.processing_text') }}
          </div>
        </template>

        <template v-else>
          <div :class="$style.text">
            {{ t('msg.preflight_dialog.subtitle') }}
          </div>

          <div :class="$style.content">
            <div
              v-for="(errorFlag, recipient) in _unavailableRecipients"
              :key="recipient"
              :class="$style.recipient"
            >
              <contact-icon
                :size="36"
                :name="recipient"
                readonly
              />

              <ui3n-tooltip
                :content="getVerificationResult(recipient, errorFlag)"
                placement="top-start"
                position-strategy="fixed"
              >
                <div :class="$style.mail">
                  {{ recipient }}
                </div>
              </ui3n-tooltip>
            </div>
          </div>

          <div :class="$style.text">
            {{ t('msg.preflight_dialog.question') }}
          </div>
        </template>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  @use '@common/assets/styles/_mixins' as mixin;

  .preFlightDialog {
    position: relative;
    width: 100%;
    min-height: 200px;
    padding: var(--spacing-m) var(--spacing-m) 0 var(--spacing-m);
  }

  .text {
    position: relative;
    width: 100%;
    font-size: var(--font-12);
    font-weight: 400;
    line-height: var(--font-16);
    color: var(--color-text-block-primary-default);
    margin-bottom: var(--spacing-s);

    &:last-child {
      margin-bottom: 0;
    }
  }

  .content {
    position: relative;
    width: 100%;
    max-height: 300px;
    overflow-y: auto;
    margin-bottom: var(--spacing-s);
  }

  .recipient {
    position: relative;
    width: 100%;
    height: var(--spacing-xxl);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .mail {
    position: relative;
    max-width: calc(100% - 44px);
    font-size: var(--font-14);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
    @include mixin.text-overflow-ellipsis(calc(100% - 44px));
  }
</style>
