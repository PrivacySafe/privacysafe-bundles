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
import { computed, ComputedRef, onBeforeMount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import size from 'lodash/size';
import { type Nullable, Ui3nButton, Ui3nClickOutside, Ui3nEmoji, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
import { useAppStore } from '@main/common/store/app.store';
import { useEmoticons } from '@main/common/composables/useEmoticons';
import type { ChatMessageReaction, ChatMessageView, RegularMsgView } from '~/index';

const vOnClickOutside = Ui3nClickOutside;

interface ReactionsDialogProps {
  open: boolean;
  recentReactions?: string[];
  msg: Nullable<ChatMessageView>;
}

interface ReactionsDialogEmits {
  (event: 'close'): void;
  (event: 'select:reaction', value: { msg: ChatMessageView; reaction: Nullable<{ id: string; value: string }> }): void;
}

const props = defineProps<ReactionsDialogProps>();
const emits = defineEmits<ReactionsDialogEmits>()

const { t } = useI18n();
const appStore = useAppStore();
const { emoticonsByGroups, groups, getEmojiById } = useEmoticons();

const dialogWidth = 240;
const dialogMaxHeight = 204;

const visible = ref(false);
const canClose = ref(false);
const isExpanded = ref(false);
const displayUp = ref(false);

const dialogWidthCss = computed(() => `${dialogWidth}px`);
const dialogMaxHeightCss = computed(() => `${dialogMaxHeight}px`);

const currentRecentReactions = computed(() => size(props.recentReactions) ? props.recentReactions : ['purple_heart']);
const messageReactions = computed(() => (props.msg as RegularMsgView)?.reactions || {}) as ComputedRef<Record<string,
  ChatMessageReaction>>;
const isThereReactionFromUser = computed(() => Object.keys(messageReactions.value).includes(appStore.user));

function closeDialog() {
  if (!canClose.value) {
    return;
  }

  visible.value = false;
  canClose.value = false;
  emits('close');
}

function toggleExpandedMode() {
  isExpanded.value = !isExpanded.value;
}

function removeMyReaction() {
  emits('select:reaction', { msg: props.msg!, reaction: null });
  closeDialog();
}

function selectIcon(data: { id: string; value: string }) {
  emits('select:reaction', { msg: props.msg!, reaction: data });
  closeDialog();
}

function selectFromRecentReactions(emojiId: string) {
  const emoji = getEmojiById(emojiId);
  if (!emoji) {
    return;
  }

  selectIcon({ id: emojiId, value: emoji!.value });
}

onBeforeMount(() => {
  if (!props.msg) {
    return;
  }

  const msgElement = document.getElementById(props.msg.chatMessageId!);
  const { top, height } = msgElement?.getBoundingClientRect() || { top: 0, height: 0 };
  const messagesElement = document.getElementById('chat-messages');
  const { top: wrapTop, height: wrapHeight } = messagesElement?.getBoundingClientRect() || { top: 0 };
  displayUp.value = wrapHeight
    ? ((top - wrapTop) + height + dialogMaxHeight) > wrapHeight
    : false;
});

watch(
  () => props.open,
  (val, oldVal) => {
    visible.value = val;
    if (val && val !== oldVal) {
      setTimeout(() => {
        canClose.value = true;
      }, 500);
    }
  }, {
    immediate: true,
  },
);
</script>

<template>
  <div
    v-if="visible"
    v-on-click-outside="closeDialog"
    :class="[
      $style.reactionsDialog,
      displayUp && $style.up,
      !msg?.isIncomingMsg && $style.left,
      msg?.isIncomingMsg && $style.right,
      isExpanded && $style.expanded
    ]"
  >
    <div :class="$style.block">
      <div
        v-if="isExpanded"
        :class="$style.label"
      >
        {{ t('chat.message.reactions_dialog.recent') }}
      </div>

      <div :class="$style.recentBody">
        <div :class="$style.recentContent">
          <ui3n-emoji
            v-for="reaction in currentRecentReactions"
            :key="reaction"
            :emoji="reaction"
            :size="28"
            :class="$style.emoji"
            @click.stop.prevent="selectFromRecentReactions(reaction)"
          />
        </div>

        <div :class="$style.recentActions">
          <ui3n-tooltip
            :content="t('chat.message.reactions_dialog.remove')"
            position-strategy="fixed"
            placement="top-end"
          >
            <ui3n-button
              type="icon"
              color="var(--color-bg-control-secondary-default)"
              icon="outline-delete"
              icon-size="20"
              icon-color="var(--error-content-default)"
              :disabled="!isThereReactionFromUser"
              @click.stop.prevent="removeMyReaction"
            />
          </ui3n-tooltip>

          <ui3n-tooltip
            :content="isExpanded
              ? t('chat.message.reactions_dialog.less')
              : t('chat.message.reactions_dialog.more')"
            position-strategy="fixed"
            placement="top-end"
          >
            <ui3n-button
              type="icon"
              color="var(--color-bg-control-secondary-default)"
              icon="round-more-vert"
              icon-size="20"
              icon-color="var(--color-icon-table-primary-default)"
              @click.stop.prevent="toggleExpandedMode"
            />
          </ui3n-tooltip>
        </div>
      </div>
    </div>

    <div
      v-if="isExpanded"
      :class="[$style.block, $style.iconsBlock]"
    >
      <div :class="$style.label">
        {{ t('chat.message.reactions_dialog.icons') }}
      </div>

      <div :class="$style.icons">
        <div
          v-for="group in groups"
          :key="group"
          :class="$style.iconsGroup"
        >
          <!--
          <h4 :class="$style.iconsGroupName">
            {{ group }}
          </h4>
           -->

          <div :class="$style.iconsGroupBody">
            <ui3n-emoji
              v-for="emoticon in emoticonsByGroups[group]"
              :key="emoticon.id"
              :emoji="emoticon.id"
              :size="28"
              :class="$style.emoji"
              @click="selectIcon({ id: emoticon.id, value: emoticon.value })"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
@use '@main/common/assets/styles/_mixins.scss' as mixins;

@keyframes scale {
  0% {
    transform: scale(1);
  }

  50% {
    transform: scale(0.75);
  }

  100% {
    transform: scale(1);
  }
}

.reactionsDialog {
  --reactions-dialog-width: v-bind(dialogWidthCss);
  --reactions-dialog-min-height: 56px;
  --reactions-dialog-expanded-height: v-bind(dialogMaxHeightCss);
  --reactions-dialog-padding: 12px 8px;

  position: absolute;
  width: var(--reactions-dialog-width);
  height: var(--reactions-dialog-min-height);
  padding: var(--reactions-dialog-padding);
  background-color: var(--color-bg-control-secondary-default);
  border-radius: var(--spacing-xs);
  top: calc(100% - var(--spacing-s));
  z-index: 100;
  @include mixins.block-shadow();

  &.up {
    top: auto;
    bottom: var(--spacing-s);
  }

  &.left {
    right: calc(5% + 12px);
  }

  &.right {
    left: calc(5% + 12px);
  }

  &.expanded {
    height: var(--reactions-dialog-expanded-height);
  }
}

.block {
  position: relative;
  width: 100%;
}

.iconsBlock {
  height: calc(100% - var(--reactions-dialog-min-height));
}

.label {
  font-size: var(--font-12);
  font-weight: 600;
  line-height: var(--font-16);
  color: var(--color-text-block-primary-default);
  margin-bottom: var(--spacing-s);
}

.recentBody {
  display: flex;
  width: 100%;
  height: var(--spacing-l);
  justify-content: space-between;
  align-items: center;
}

.recentContent,
.recentActions {
  display: flex;
  justify-content: center;
  align-items: center;
}

.recentContent {
  column-gap: var(--spacing-xs);
}

.emoji {
  position: relative;

  &:hover {
    animation: scale 0.4s ease-in-out;
  }
}

.icons {
  position: relative;
  width: 100%;
  height: calc(100% - 24px);
  overflow-x: hidden;
  overflow-y: auto;

  .iconsGroup:last-child {
    padding-bottom: 0;
  }
}

.iconsGroup {
  padding-bottom: var(--spacing-s);
}

.iconsGroupBody {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  row-gap: var(--spacing-s);
}
</style>
