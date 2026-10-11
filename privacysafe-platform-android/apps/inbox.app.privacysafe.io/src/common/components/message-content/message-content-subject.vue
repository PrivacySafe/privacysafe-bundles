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
  import hasIn from 'lodash/hasIn';
  import dayjs from 'dayjs';
  import type { IncomingMessageView, OutgoingMessageView } from '@common/types';

  const props = defineProps<{
    message: IncomingMessageView | OutgoingMessageView;
  }>();

  const dateTimeFormat = 'HH:mm, MMM DD';

  const isIncomingMessage = computed(() => hasIn(props.message, 'sender'));
  const time = computed(() => {
    if (isIncomingMessage.value) {
      return dayjs(props.message.deliveryTS).format(dateTimeFormat)
    }

    return dayjs(props.message.cTime || 0).format(dateTimeFormat);
  });
</script>

<template>
  <div :class="$style.msgSubject">
    <div :class="$style.text">
      {{ message?.subject }}
    </div>

    <div :class="$style.time">
      {{ time }}
    </div>
  </div>
</template>

<style lang="scss" module>
  .msgSubject {
    position: relative;
    width: 100%;
    padding: 12px var(--spacing-m);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    column-gap: var(--spacing-m);
    border-bottom: 1px solid var(--color-border-block-primary-default);
  }

  .text {
    position: relative;
    flex-grow: 1;
    font-size: var(--font-16);
    line-height: 1.3;
    font-weight: 600;
    color: var(--color-text-chat-bubble-other-default);
  }

  .time {
    font-size: var(--font-14);
    line-height: 1;
    font-weight: 500;
    color: var(--color-text-control-secondary-default);
  }
</style>
