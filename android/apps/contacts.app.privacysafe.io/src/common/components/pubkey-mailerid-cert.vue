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
import { getKeyCert } from '@shared/jwkeys';
import { algToHumanString } from '@main/common/utils/keys-info';

type PKeyCertChain = web3n.keys.PKeyCertChain;

const props = defineProps<{
  pkeyCert: PKeyCertChain;
}>();

const { t } = useI18n();

const pkey = computed(() => getKeyCert(props.pkeyCert.pkeyCert));
const expiry = computed(() => new Date(pkey.value.expiresAt * 1000));
const providerPKey = computed(() => getKeyCert(props.pkeyCert.provCert));
const publicKey = computed(() => pkey.value.cert.publicKey);
</script>

<template>
  <div>
    <div :class="$style.row">
      <b>{{ t('keys-info.key-id') }}:</b> {{ publicKey.kid }}
    </div>

    <div :class="$style.row">
      <b>{{ t('keys-info.expiry') }}:</b> {{ expiry.toLocaleString() }}
    </div>

    <div :class="$style.row">
      <b>{{ t('keys-info.alg') }}:</b> {{ algToHumanString(publicKey.alg) }}
    </div>

    <div :class="$style.row">
      <b>{{ t('keys-info.mid-certifier') }}:</b> {{ providerPKey.issuer }}
    </div>
  </div>
</template>

<style lang="scss" module>
.row {
  padding: var(--spacing-xs) 0;
  line-height: 1.5;
}
</style>
