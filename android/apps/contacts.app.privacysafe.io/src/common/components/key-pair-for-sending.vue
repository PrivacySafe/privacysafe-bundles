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
import { useI18n } from 'vue-i18n';
import { algToHumanString } from '@main/common/utils/keys-info';

defineProps<{
  sendingPair: web3n.keys.RatchetedSendingPairInfo;
}>();

const { t } = useI18n();
</script>

<template>
  <div>
    <div :class="$style.row">
      <b>{{ t('keys-info.your-key-id') }}:</b> {{ sendingPair.senderKId }}
    </div>

    <div :class="$style.row">
      <b>{{ t('keys-info.contact-key-id') }}:</b> {{ sendingPair.recipientKId }}
    </div>

    <div :class="$style.row">
      <b>{{ t('keys-info.alg') }}:</b> {{ algToHumanString(sendingPair.alg) }}
    </div>

    <div :class="$style.row">
      <b>{{ t('keys-info.timestamp') }}:</b> {{ new Date(sendingPair.timestamp).toLocaleString() }}
    </div>

    <div
      v-if="sendingPair.sentMsgs"
      :class="$style.row"
    >
      <b>{{ t('keys-info.last-msg-ts') }}:</b> {{ new Date(sendingPair.sentMsgs!.lastTS)?.toLocaleString() }}
    </div>

    <div
      v-if="sendingPair.sentMsgs"
      :class="$style.row"
    >
      <b>{{ t('keys-info.num-of-sent-msgs') }}:</b> {{ sendingPair.sentMsgs!.count || 0 }}
    </div>

    <div :class="$style.row">
      <b>{{ t('keys-info.random-pids') }}:</b> {{ sendingPair.pids.join(', ') }}
    </div>
  </div>
</template>

<style lang="scss" module>
.row {
  padding: var(--spacing-xs) 0;
  line-height: 1.5;
}
</style>
