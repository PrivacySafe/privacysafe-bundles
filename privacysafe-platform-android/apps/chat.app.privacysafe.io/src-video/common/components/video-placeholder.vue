<!--
 Copyright (C) 2024 3NSoft Inc.

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
  import ChatAvatar from '@main/common/components/chat/chat-avatar.vue';

  interface VideoPlaceholderProps {
    userName: string;
    width?: number | string;
  }

  withDefaults(defineProps<VideoPlaceholderProps>(), {
    width: 144,
  });
</script>

<template>
  <div :class="$style.videoPlaceholder">
    <chat-avatar
      :size="width"
      :name="userName ?? ' '"
    />

    <span>{{ userName }}</span>
  </div>
</template>

<style lang="scss" module>
  .videoPlaceholder {
    width: 100%;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    row-gap: var(--spacing-s);
    font-size: var(--font-13);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
    transform: none;

    span {
      display: block;
      box-sizing: border-box;
      position: relative;
      width: 100%;
      padding: 0 var(--spacing-s);
      text-align: center;
      word-break: break-all;
    }
  }
</style>
