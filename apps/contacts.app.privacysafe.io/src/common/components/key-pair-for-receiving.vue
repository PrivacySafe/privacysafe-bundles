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
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { algToHumanString } from '@main/common/utils/keys-info';

const props = defineProps<{
  receivingPair: web3n.keys.ReceptionPairInfo;
}>();

const { t } = useI18n();

const msgsCounts = computed(() => {
  if (props.receivingPair.receivedMsgs) {
    return props.receivingPair.receivedMsgs.counts.map(([a, b]) => `${a}-${b}`).join(', ');
  }

  return '';
});
</script>

<template>
  <div>
    <div :class="$style.row">
      <b>{{ t(receivingPair.isSenderIntroKey ? 'keys-info.contact-intro-key-id' : 'keys-info.contact-key-id') }}:</b>
      {{ receivingPair.senderKId }}
    </div>

    <div :class="$style.row">
      <b>{{ t('keys-info.your-key-id') }}:</b> {{ receivingPair.recipientKId }}
    </div>

    <div :class="$style.row">
      <b>{{ t('keys-info.alg') }}:</b> {{ algToHumanString(receivingPair.alg) }}
    </div>

    <div :class="$style.row">
      <b>{{ t('keys-info.timestamp') }}:</b> {{ new Date(receivingPair.timestamp).toLocaleString() }}
    </div>

    <div
      v-if="receivingPair.receivedMsgs"
      :class="$style.row"
    >
      <b>{{ t('keys-info.last-msg-ts') }}:</b>
      {{ new Date(receivingPair.receivedMsgs?.lastTS).toLocaleString() }}
    </div>

    <div
      v-if="receivingPair.receivedMsgs"
      :class="$style.row"
    >
      <b>{{ t('keys-info.received-msgs') }}:</b> {{ msgsCounts }}
    </div>

    <div :class="$style.row">
      <b>{{ t('keys-info.random-pids') }}:</b> {{ receivingPair.pids.join(', ') }}
    </div>
  </div>
</template>

<style lang="scss" module>
.row {
  padding: var(--spacing-xs) 0;
  line-height: 1.5;
}
</style>
