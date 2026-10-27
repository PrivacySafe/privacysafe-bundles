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

  const props = withDefaults(
    defineProps<{
      channel?: 0 | 1 | 2 | '0' | '1' | '2';
      fontSize?: number;
    }>(),
    {
      channel: 1,
      fontSize: 9,
    },
  );

  const channelInfo = {
    0: {
      label: 'Main',
      color: 'var(--info-content-default)',
    },
    1: {
      label: 'Beta',
      color: 'var(--success-content-default)',
    },
    2: {
      label: 'Nightly',
      color: 'var(--warning-content-default)',
    },
  };

  const mainStyle = computed(() => {
    if (['1', '2', 1, 2].includes(props.channel)) {
      return {
        '--channel-text-color': channelInfo[props.channel].color,
        '--channel-text-size': `${props.fontSize}px`,
      };
    }

    return null;
  });
</script>

<template>
  <div
    v-if="['1', '2', 1, 2].includes(channel)"
    :class="$style.installationChannel"
    :style="mainStyle"
  >
    {{ channelInfo[channel].label }}
  </div>
</template>

<style lang="scss" module>
  .installationChannel {
    --channel-text-color: var(--info-content-default);
    --channel-text-size: 9px;

    //position: relative;
    font-size: var(--channel-text-size);
    font-weight: 700;
    line-height: 1;
    color: var(--channel-text-color);
    padding: 2px 6px;
    border-radius: 2px;
    background-color: var(--color-bg-block-primary-default);
  }
</style>
