<!--
 Copyright (C) 2020 - 2024 3NSoft Inc.

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
  import { generateColor } from '@v1nt1248/3nclient-lib/utils';
  import { Ui3nIcon } from '@v1nt1248/3nclient-lib';

  const props = defineProps<{
    size?: number;
    name?: string;
    photo?: string;
    isGroup?: boolean;
    selected?: boolean;
    readonly?: boolean;
  }>();
  const emit = defineEmits(['click']);

  const letters = computed<string>(() => {
    if (props.name && !props.photo) {
      return props.name.length === 1
        ? props.name.toLocaleUpperCase()
        : `${props.name[0].toLocaleUpperCase()}${props.name[1].toLocaleLowerCase()}`;
    }
    return '';
  });

  const innerSize = computed<number>(() => props.size || 24);
  const mainStyle = computed<Record<string, string>>(() => {
    const styles: Record<string, string> = {
      minWidth: `${innerSize.value}px`,
      width: `${innerSize.value}px`,
      minHeight: `${innerSize.value}px`,
      height: `${innerSize.value}px`,
      backgroundColor: generateColor(letters.value || '?'),
    };
    return props.photo
      ? {
          ...styles,
          backgroundImage: `url(${props.photo})`,
        }
      : styles;
  });
  const nameStyle = computed<Record<string, string>>(() => ({
    fontSize: `${Math.floor(innerSize.value * 0.5) - 6}px`,
  }));

  const onClick = (ev: MouseEvent): void => {
    emit('click', ev);
  };
</script>

<template>
  <div
    :class="[$style.contactIcon, selected && $style.contactIconSelected]"
    :style="mainStyle"
    v-on="readonly ? {} : { click: onClick }"
  >
    <div
      v-if="!photo"
      :class="$style.contactIconLetter"
      :style="nameStyle"
    >
      {{ letters }}
    </div>

    <div
      v-if="selected"
      :class="$style.contactIconIcon"
    >
      <ui3n-icon
        icon="round-check"
        :width="innerSize / 3 - 2"
        :height="innerSize / 3 - 2"
        color="var(--white-0)"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .contactIcon {
    position: relative;
    box-sizing: border-box;
    border-radius: 50%;
    display: flex;
    justify-content: center;
    align-items: center;
    background-repeat: no-repeat;
    background-position: 50% 50%;
    background-size: cover;
  }

  .contactIconLetter {
    -webkit-font-smoothing: antialiased;
    color: var(--color-text-avatar-primary-default);
    font-weight: 600;
    line-height: 1;
    z-index: 1;
    pointer-events: none;
    user-select: none;
    text-shadow: 2px 2px 5px var(--grey-70);
  }

  .contactIconSelected {
    &::before {
      content: '';
      position: absolute;
      width: 100%;
      height: 100%;
      background-color: transparent;
      box-sizing: border-box;
      border-radius: 50%;
      border: 4px solid var(--default-fill-default);
    }

    &::after {
      content: '';
      position: absolute;
      width: 100%;
      height: 100%;
      background-color: transparent;
      box-sizing: border-box;
      border-radius: 50%;
      border: 2px solid var(--color-border-control-accent-default);
    }
  }

  .contactIconIcon {
    position: absolute;
    width: calc(100% / 3);
    height: calc(100% / 3);
    border-radius: 50%;
    background-color: var(--color-border-control-accent-default);
    bottom: 0;
    right: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1;
  }
</style>
