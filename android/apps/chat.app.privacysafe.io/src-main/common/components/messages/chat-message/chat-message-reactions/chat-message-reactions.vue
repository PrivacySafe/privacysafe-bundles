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
import size from 'lodash/size';
import { Ui3nEmoji } from '@v1nt1248/3nclient-lib';
import type { ChatMessageReaction } from '~/index';

const props = defineProps<{
  reactions: Record<string, ChatMessageReaction> | undefined;
  isIncomingMsg?: boolean;
}>();

const hasMsgReactions = computed(() => size(props.reactions) > 0);

const displayedReactionsObj = computed(() => hasMsgReactions.value
  ? Object.values(props.reactions || {})
    .reduce((res, reaction) => {
      const { type, name } = reaction;
      if (type !== 'emoji') {
        return res;
      }

      if (!res[name]) {
        res[name] = 0;
      }
      res[name] += 1;

      return res;
    }, {} as Record<string, number>)
  : {},
);
const displayedReactions = computed(() => hasMsgReactions.value
  ? Object.keys(displayedReactionsObj.value).map(reactionId => {
    const count = displayedReactionsObj.value[reactionId];
    return { reaction: reactionId, count };
  })
  : []
)
</script>

<template>
  <div :class="$style.chatMessageReactions">
    <template v-if="hasMsgReactions">
      <div
        v-for="item in displayedReactions"
        :key="item.reaction"
        :class="[$style.item, isIncomingMsg && $style.incoming]"
      >
        <ui3n-emoji
          :emoji="item.reaction"
          :size="16"
        />

        <span v-if="item.count > 1">{{ item.count }}</span>
      </div>
    </template>
  </div>
</template>

<style lang="scss" module>
.chatMessageReactions {
  flex-grow: 1;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  align-items: flex-start;
  gap: var(--spacing-xs);
  min-width: var(--spacing-xs);
}

.item {
  position: relative;
  min-width: 24px;
  min-height: 24px;
  height: 24px;
  border-radius: 24px;
  padding: 4px;
  background-color: var(--color-bg-chat-bubble-other-default);
  display: flex;
  justify-content: center;
  align-items: center;
  column-gap: 4px;
  color: var(--color-text-chat-bubble-other-default);

  span {
    font-size: var(--font-14);
    font-weight: 500;
    line-height: var(--font-14) !important;
  }

  &.incoming {
    background-color: var(--color-bg-chat-bubble-user-default);
  }
}
</style>
