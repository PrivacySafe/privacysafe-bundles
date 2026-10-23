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
  Marks the tile of the call's host - the participant whose app relays
  everyone's media. Top left, mirroring the muted-mic mark in the top right of
  a peer's tile (peer-video.vue), at the same size.
-->
<script lang="ts" setup>
  import { useI18n } from 'vue-i18n';
  import { Ui3nIcon } from '@v1nt1248/3nclient-lib';

  const { size = 'normal' } = defineProps<{
    size?: 'normal' | 'small';
  }>();

  const { t } = useI18n();
</script>

<template>
  <div
    :class="[$style.hostBadge, size === 'small' && $style.small]"
    :title="t('call.text.host')"
  >
    <ui3n-icon
      icon="host-outline-rounded"
      color="var(--color-icon-control-accent-default)"
      :size="size === 'small' ? 15 : 20"
    />
  </div>
</template>

<style lang="scss" module>
  .hostBadge {
    --host-badge-size: 30px;

    position: absolute;
    left: calc(var(--host-badge-size) / 4);
    top: calc(var(--host-badge-size) / 4);
    width: var(--host-badge-size);
    height: var(--host-badge-size);
    border-radius: 50%;
    display: flex;
    justify-content: center;
    align-items: center;
    border: 2px solid var(--color-icon-control-accent-default);
    z-index: 1;
  }

  .small {
    --host-badge-size: 20px;
  }
</style>
