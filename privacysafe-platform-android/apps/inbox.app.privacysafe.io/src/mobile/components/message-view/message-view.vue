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
  import type { IncomingMessageView, MessageAction, OutgoingMessageView } from '@common/types';
  import MessageContent from '@common/components/message-content/message-content.vue';

  defineProps<{
    message: IncomingMessageView | OutgoingMessageView;
  }>();
  const emits = defineEmits<{
    (event: 'mark-as-read'): void;
  }>();

  function handleAction(value: { action: MessageAction }) {
    if (value.action === 'mark-as-read') {
      emits('mark-as-read');
    }
  }
</script>

<template>
  <div :class="$style.messageView">
    <message-content
      :message="message"
      @action="handleAction"
    />
  </div>
</template>

<style lang="scss" module>
  .messageView {
    position: relative;
    width: 100%;
    height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
  }
</style>
