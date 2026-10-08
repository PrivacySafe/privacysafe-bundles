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
  import { useI18n } from 'vue-i18n';
  import isEmpty from 'lodash/isEmpty';
  import { Ui3nEmoji } from '@v1nt1248/3nclient-lib';
  import { useInfoChanges } from './useInfoChanges';
  import type { ChatMessageHistoryChange, ChatMessageReaction } from '~/index';

  const props = defineProps<{
    currentReactions: Record<string, ChatMessageReaction>;
    changes: ChatMessageHistoryChange[];
    timestamp: number;
  }>();

  const { t } = useI18n();

  const reactionsChanges = computed(() =>
    props.changes.filter(c => c.type === 'reaction').sort((a, b) => b.timestamp - a.timestamp),
  );

  const { prepareTimeForBlockNow, prepareTimeForBlockHistory } = useInfoChanges(reactionsChanges, props.timestamp);
</script>

<template>
  <div :class="$style.chatMessageInfoReactions">
    <h4 :class="$style.label">
      {{ t('chat.message.info.label.now') }}
    </h4>

    <div :class="$style.now">
      <div :class="$style.item">
        <span :class="$style.time">
          {{ prepareTimeForBlockNow() }}
        </span>

        <div
          v-if="!isEmpty(currentReactions)"
          :class="$style.reactions"
        >
          <div
            v-for="(reaction, addr) in currentReactions"
            :key="addr"
            :class="$style.reaction"
          >
            <ui3n-emoji
              :emoji="reaction.name"
              :size="24"
            />

            <span :class="$style.name">
              {{ addr }}
            </span>
          </div>
        </div>

        <div
          v-else
          :class="$style.noData"
        >
          {{ t('chat.message.info.text.no_reactions') }}
        </div>
      </div>
    </div>

    <hr :class="$style.delimiter">

    <h4 :class="$style.label">
      {{ t('chat.message.info.label.history') }} ({{ t('chat.message.info.label.state') }})
    </h4>

    <div
      v-if="isEmpty(reactionsChanges)"
      :class="$style.noData"
    >
      {{ t('chat.message.info.text.no_changes') }}
    </div>

    <div
      v-else
      :class="$style.changes"
    >
      <div
        v-for="(change, index) in reactionsChanges"
        :key="change.timestamp"
        :class="$style.item"
      >
        <span :class="$style.time">
          {{ prepareTimeForBlockHistory(index) }}
        </span>

        <div
          v-if="isEmpty(change.value)"
          :class="$style.noData"
        >
          {{ t('chat.message.info.text.no_reactions') }}
        </div>

        <template v-else>
          <div
            v-for="(reaction, addr) in change.value as Record<string, ChatMessageReaction>"
            :key="addr"
            :class="$style.reaction"
          >
            <ui3n-emoji
              :emoji="reaction.name"
              :size="24"
            />

            <span :class="$style.name">
              {{ addr }}
            </span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
  .chatMessageInfoReactions {
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
    padding: var(--spacing-s);
    border-radius: var(--spacing-s);
    border: 1px solid var(--color-border-control-secondary-default);
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

  .reactions {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: flex-start;
    row-gap: var(--spacing-xs);
  }

  .reaction {
    width: fit-content;
    max-width: 100%;
    height: var(--spacing-l);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-m);
  }

  .name {
    font-size: var(--font-14);
    font-weight: 500;
    color: var(--color-text-block-primary-default);
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
