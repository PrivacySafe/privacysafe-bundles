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
<script lang="ts" setup>
  import { computed } from 'vue';
  import { Ui3nIcon } from '@v1nt1248/3nclient-lib';

  const ICON_SIZES = { small: 12, large: 32 } as const;

  const props = withDefaults(
    defineProps<{
      isLink?: boolean;
      placement?: 'corner' | 'inline';
      size?: keyof typeof ICON_SIZES;
    }>(),
    {
      isLink: true,
      placement: 'corner',
      size: 'small',
    },
  );

  const iconSize = computed(() => ICON_SIZES[props.size]);
</script>

<template>
  <span :class="[$style.linkBadge, $style[placement]]">
    <slot />

    <ui3n-icon
      v-if="isLink"
      icon="arrow-top-right"
      :size="iconSize"
      color="var(--color-icon-block-warning-default)"
      :class="$style.icon"
    />
  </span>
</template>

<style lang="scss" module>
  .linkBadge {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .inline {
    column-gap: var(--spacing-xs);

    .icon {
      order: -1;
    }
  }

  .corner {
    .icon {
      position: absolute;
      bottom: 0;
      right: -2px;
    }
  }
</style>
