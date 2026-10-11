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
<script setup lang="ts">
  import { computed } from 'vue';
  import isEmpty from 'lodash/isEmpty';
  import { Ui3nHtml } from '@v1nt1248/3nclient-lib';
  import { useInfoChanges } from './useInfoChanges';
  import type { ChatMessageHistoryChange } from '~/index';

  const vUi3nHtml = Ui3nHtml;

  const props = defineProps<{
    currentText: string;
    changes: ChatMessageHistoryChange[];
    timestamp: number;
  }>();

  const msgTextChanges = computed(() =>
    props.changes.filter(c => c.type === 'body').sort((a, b) => b.timestamp - a.timestamp),
  );

  const { t, prepareTimeForBlockNow, prepareTimeForBlockHistory } = useInfoChanges(
    msgTextChanges,
    props.timestamp,
  );
</script>

<template>
  <div :class="$style.chatMessageInfoText">
    <h4 :class="$style.label">
      {{ t('chat.message.info.label.now') }}
    </h4>

    <div :class="$style.now">
      <div :class="$style.item">
        <span :class="$style.time">
          {{ prepareTimeForBlockNow() }}
        </span>

        <div
          v-if="currentText"
          :class="$style.msg"
        >
          <div
            v-ui3n-html:sanitize="{
              dirty: currentText,
              allowedAttributes: { '*': ['class', 'data-mention', 'data-href'] },
            }"
            :class="$style.text"
          />
        </div>

        <div
          v-else
          :class="$style.noData"
        >
          {{ t('chat.message.info.text.no_body') }}
        </div>
      </div>
    </div>

    <hr :class="$style.delimiter">

    <h4 :class="$style.label">
      {{ t('chat.message.info.label.history') }} ({{ t('chat.message.info.label.state') }})
    </h4>

    <div
      v-if="isEmpty(msgTextChanges)"
      :class="$style.noData"
    >
      {{ t('chat.message.info.text.no_changes') }}
    </div>

    <div
      v-else
      :class="$style.changes"
    >
      <div
        v-for="(change, index) in msgTextChanges"
        :key="change.timestamp"
        :class="$style.item"
      >
        <span :class="$style.time">
          {{ prepareTimeForBlockHistory(index) }}
        </span>

        <div :class="$style.msg">
          <div
            v-ui3n-html:sanitize="{
              dirty: change.value,
              allowedAttributes: { '*': ['class', 'data-mention', 'data-href'] },
            }"
            :class="$style.text"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
  .chatMessageInfoText {
    --message-max-width: 720px;
    --message-min-width: 112px;

    position: relative;
    width: 100%;
    height: 100%;
    overflow-y: auto;
  }

  .label {
    width: 100%;
    font-weight: 500;
    text-align: center;
    color: var(--color-text-block-primary-default);
    margin: 0 0 var(--spacing-s) 0;
  }

  .now,
  .changes {
    width: 92%;
    margin: 0 4%;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    row-gap: var(--spacing-m);
  }

  .now {
    align-items: flex-start;
    padding-right: var(--spacing-m);

    .item {
      align-items: flex-start;
    }
  }

  .changes {
    align-items: flex-end;
    padding-left: var(--spacing-m);

    .item {
      align-items: flex-end;
    }

    .noData {
      margin-top: var(--spacing-m);
    }
  }

  .item {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    row-gap: var(--spacing-xs);
  }

  .time {
    font-size: var(--font-12);
    font-weight: 500;
    color: var(--color-text-block-secondary-default);
  }

  .user {
    font-size: var(--font-13);
    font-weight: 600;
    font-style: italic;
    color: var(--color-text-block-secondary-default);
  }

  .msg {
    position: relative;
    max-width: 100%;
    width: fit-content;
    overflow-wrap: break-word;
    word-break: normal;
    display: flex;
    align-items: flex-start;
    border-radius: var(--spacing-s);
    padding: var(--spacing-s) 12px;
    background-color: var(--color-bg-chat-bubble-user-default);
  }

  .text {
    font-family: Inter, system-ui, sans-serif;
    font-size: var(--font-14);
    font-weight: 400;
    line-height: var(--font-20);
    margin: 0;
    white-space: pre-wrap;
    color: var(--color-text-chat-bubble-other-default);
  }

  .delimiter {
    position: relative;
    width: 92%;
    height: 1px;
    margin: var(--spacing-m) 4%;
    border: none;
    background-color: var(--color-text-chat-bubble-other-default);
  }

  .noData {
    font-size: var(--font-16);
    font-weight: 500;
    color: var(--color-text-block-secondary-default);
    text-align: center;
  }
</style>
