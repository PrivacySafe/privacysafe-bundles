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
  import { computed, onBeforeMount, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Ui3nDialog, type Ui3nDialogComponentProps } from '@v1nt1248/3nclient-lib';
  import IntroSendingKeyPair from '@main/common/components/intro-key-pair-for-sending.vue';
  import SendingKeyPair from '@main/common/components/key-pair-for-sending.vue';
  import ReceivingKeyPair from '@main/common/components/key-pair-for-receiving.vue';

  type CorrespondentKeysInfo = web3n.keys.CorrespondentKeysInfo;

  const props = defineProps<{
    contactAddr: string;
    dialogProps?: Ui3nDialogComponentProps<boolean>;
  }>();

  const { t } = useI18n();

  const mailKeys = ref<CorrespondentKeysInfo | undefined>();
  const receptionPairs = computed(() => mailKeys.value?.receptionPairs);
  const sendingPair = computed(() => mailKeys.value?.sendingPair);

  onBeforeMount(async () => {
    mailKeys.value = await w3n.keyrings!.getCorrespondentKeys(props.contactAddr);
  });

  const isMailKeysEmpty = computed(() => {
    return (
      !sendingPair.value &&
      !receptionPairs.value?.inUse &&
      !receptionPairs.value?.old &&
      !receptionPairs.value?.suggested
    );
  });
</script>

<template>
  <ui3n-dialog v-bind="dialogProps">
    <template #body>
      <div :class="$style.content">
        <fieldset v-if="sendingPair">
          <legend>{{ t('keys-info.sending-key-pair') }}</legend>

          <intro-sending-key-pair
            v-if="sendingPair.type === 'intro'"
            :sending-pair="sendingPair"
          />

          <sending-key-pair
            v-else
            :sending-pair="sendingPair"
          />
        </fieldset>

        <fieldset v-if="receptionPairs?.inUse">
          <legend>{{ t('keys-info.receiving-key-pair-in-use') }}</legend>

          <receiving-key-pair :receiving-pair="receptionPairs.inUse" />
        </fieldset>

        <fieldset v-if="receptionPairs?.suggested">
          <legend>{{ t('keys-info.receiving-key-pair-suggested') }}</legend>

          <receiving-key-pair :receiving-pair="receptionPairs.suggested" />
        </fieldset>

        <fieldset v-if="receptionPairs?.old">
          <legend>{{ t('keys-info.receiving-key-pair-old') }}</legend>

          <receiving-key-pair :receiving-pair="receptionPairs.old" />
        </fieldset>
        <div
          v-if="isMailKeysEmpty"
          :class="$style.noData"
        >
          {{ t('keys-info.no-contact-keys') }}
        </div>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .content {
    position: relative;
    color: var(--color-text-block-primary-default);
    padding: var(--spacing-m) var(--spacing-s);
    min-height: 200px;
    max-height: 480px;
    overflow-y: auto;
  }

  fieldset {
    border: 1px solid var(--color-border-control-accent-default);
    border-radius: var(--spacing-xs);
    padding: var(--spacing-m) var(--spacing-s) var(--spacing-s);
    margin: 0 0 var(--spacing-s) 0;

    legend {
      font-size: var(--font-16);
      font-weight: 600;
    }
  }

  .noData {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
  }
</style>
