<!--
 Copyright (C) 2024 - 2025 3NSoft Inc.

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
  import VideoPlaceholder from '@video/common/components/video-placeholder.vue';
  import VideoStream from '@video/common/components/video-stream.vue';
  import HostBadge from '@video/common/components/host-badge.vue';

  const {
    user,
    stream,
    isCamOn,
    isHost = false,
    size = 'normal',
  } = defineProps<{
    user: string;
    stream: MediaStream;
    isCamOn: boolean;
    /** We host this call. */
    isHost?: boolean;
    size?: 'normal' | 'small';
  }>();
</script>

<template>
  <div :class="$style.ownVideo">
    <video-stream
      v-if="isCamOn"
      :stream="stream"
      :is-stream-own="true"
      :muted="true"
    />

    <video-placeholder
      v-else
      :user-name="user"
      :width="size === 'small' ? 72 : 144"
    />

    <host-badge
      v-if="isHost"
      :size="size"
    />
  </div>
</template>

<style lang="scss" module>
  .ownVideo {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
  }
</style>
