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
  import { Ui3nButton, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import type { IncomingMessageView, MessageAction, OutgoingMessageView } from '@common/types';

  const props = defineProps<{
    message: OutgoingMessageView;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { action: MessageAction; message: IncomingMessageView | OutgoingMessageView }): void;
  }>();

  const { t } = useI18n();

  function editMessage() {
    emits('action', { action: 'edit', message: props.message });
  }

  function sendMessage() {
    emits('action', { action: 'send', message: props.message });
  }
</script>

<template>
  <div :class="$style.headerOutbox">
    <ui3n-tooltip
      :content="t('msg.content.tooltip.edit')"
      position-strategy="fixed"
      placement="top-start"
    >
      <ui3n-button
        type="secondary"
        icon="outline-edit"
        icon-color="var(--color-icon-button-secondary-default)"
        icon-position="left"
        :class="$style.btn"
        @click.stop.prevent="editMessage"
      >
        {{ t('msg.content.tooltip.edit') }}
      </ui3n-button>
    </ui3n-tooltip>

    <ui3n-tooltip
      :content="t('msg.content.tooltip.send')"
      position-strategy="fixed"
      placement="top-start"
    >
      <ui3n-button
        type="secondary"
        icon="send-variant-outline"
        icon-color="var(--color-icon-button-secondary-default)"
        icon-position="left"
        :class="$style.btn"
        @click.stop.prevent="sendMessage"
      >
        {{ t('msg.content.tooltip.send') }}
      </ui3n-button>
    </ui3n-tooltip>
  </div>
</template>

<style lang="scss" module>
  .headerOutbox {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    padding-left: var(--spacing-s);
  }

  .btn {
    /* the buttons sit on the header, so they take its background */
    --ui3n-button-bg-color: var(--color-bg-block-primary-default);
  }
</style>
