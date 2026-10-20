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
import { onBeforeMount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Ui3nButton,
  Ui3nDialog,
  Ui3nProgressCircular,
  type Nullable,
  type Ui3nDialogComponentProps,
} from '@v1nt1248/3nclient-lib';
import PubkeyMaileridCert from '@main/common/components/pubkey-mailerid-cert.vue';

type PKeyCertChain = web3n.keys.PKeyCertChain;

defineProps<{
  dialogProps?: Ui3nDialogComponentProps<boolean>;
}>();

const { t } = useI18n();

const isLoading = ref(false);
const keyOnServer = ref<Nullable<PKeyCertChain>>(null);

async function makeNewIntroKeyAndPlaceOnServer(): Promise<void> {
  try {
    isLoading.value = true;
    keyOnServer.value = await w3n.keyrings!.introKeyOnASMailServer.makeAndPublishNew();
  } finally {
    isLoading.value = false;
  }
}

async function removeIntroKeyOnServer(): Promise<void> {
  try {
    isLoading.value = true;
    await w3n.keyrings!.introKeyOnASMailServer.remove();
    keyOnServer.value = await w3n.keyrings!.introKeyOnASMailServer.getCurrent();
  } finally {
    isLoading.value = false;
  }
}

onBeforeMount(async () => {
  keyOnServer.value = await w3n.keyrings!.introKeyOnASMailServer.getCurrent();
});
</script>

<template>
  <ui3n-dialog v-bind="dialogProps">
    <template #body>
      <div :class="$style.overallContent">
        <div v-if="keyOnServer">
          <h4 :class="$style.title">
            {{ t('keys-info.key-on-server.section') }}
          </h4>

          <div :class="$style.actions">
            <ui3n-button @click.stop.prevent="makeNewIntroKeyAndPlaceOnServer">
              {{ t('keys-info.key-on-server.btn.update') }}
            </ui3n-button>

            <ui3n-button @click.stop.prevent="removeIntroKeyOnServer">
              {{ t('keys-info.key-on-server.btn.remove') }}
            </ui3n-button>
          </div>

          <pubkey-mailerid-cert :pkey-cert="keyOnServer" />
        </div>

        <div v-else>
          <div>{{ t('keys-info.key-on-server.no-key') }}</div>

          <ui3n-button
            :class="$style.btn"
            @click.stop.prevent="makeNewIntroKeyAndPlaceOnServer"
          >
            {{ t('keys-info.key-on-server.btn.make-new') }}
          </ui3n-button>
        </div>

        <div
          v-if="isLoading"
          :class="$style.loader"
        >
          <ui3n-progress-circular
            indeterminate
            size="80"
          />
        </div>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
.overallContent {
  position: relative;
  padding: var(--spacing-m);
  color: var(--color-text-control-primary-default);
}

.title {
  font-size: var(--font-16);
  font-weight: 600;
  text-align: center;
  margin: 0 0 var(--spacing-m) 0;
}

.actions {
  display: flex;
  justify-content: center;
  align-items: center;
  column-gap: var(--spacing-m);
  margin-bottom: var(--spacing-m);
}

.btn {
  margin-top: var(--spacing-m);
}

.loader {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: var(--shadow-key-1);
}
</style>
