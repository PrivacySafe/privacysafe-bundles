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
import { Ui3nClickOutside, Ui3nEmoji } from '@v1nt1248/3nclient-lib';
import { useEmoticons } from '@main/common/composables/useEmoticons';

const vOnClickOutside = Ui3nClickOutside;

defineProps<{
  open: boolean;
}>();
const emits = defineEmits(['close', 'select']);

const { emoticonsByGroups, groups } = useEmoticons();

function closeDialog() {
  emits('close');
}

function selectEmoticon({ id, value }: { id: string, value: string }) {
  emits('select', { id, value });
  closeDialog();
}
</script>

<template>
  <div
    v-if="open"
    v-on-click-outside="closeDialog"
    :class="$style.emoticonsDialog"
  >
    <div :class="$style.emoticonsDialogBody">
      <div
        v-for="group in groups"
        :key="group"
        :class="$style.emoticonsDialogGroup"
      >
        <!--
        <h4 :class="$style.emoticonsDialogGroupName">
          {{ group }}
        </h4>
         -->
        <div :class="$style.emoticonsDialogGroupBody">
          <ui3n-emoji
            v-for="emoticon in emoticonsByGroups[group]"
            :key="emoticon.id"
            :emoji="emoticon.id"
            :size="28"
            :class="$style.emoji"
            @click="selectEmoticon({ id: emoticon.id, value: emoticon.value })"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
@use '@main/common/assets/styles/_mixins.scss' as mixins;

@keyframes scale {
  0% { transform: scale(1); }
  50% { transform: scale(0.75); }
  100% { transform: scale(1); }
}

.emoticonsDialog {
  --emoticons-dialog-padding: calc(var(--spacing-s) * 1.5);

  position: absolute;
  width: 204px;
  height: 200px;
  padding: var(--emoticons-dialog-padding) var(--spacing-s) var(--emoticons-dialog-padding);
  background-color: var(--color-bg-block-primary-default);
  border-radius: var(--spacing-xs);
  bottom: 100%;
  left: calc(var(--spacing-xs) / 2);
  z-index: 5;
  @include mixins.block-shadow();

  &::before,
  &::after {
    content: ' ';
    position: absolute;
    width: 0;
    height: 0;
  }

  &::before {
    left: 8px;
    bottom: -12px;
    border: 6px solid;
    border-color: var(--color-text-chat-bubble-other-default) transparent transparent transparent;
  }

  &::after {
    left: 9px;
    bottom: -10px;
    border: 5px solid;
    border-color: var(--color-bg-block-primary-default) transparent transparent transparent;
  }
}

.emoticonsDialogBody {
  position: relative;
  width: 100%;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;

  .emoticonsDialogGroup:last-child {
    padding-bottom: 0;
  }
}

.emoticonsDialogGroup {
  padding-bottom: var(--spacing-s);
}

.emoticonsDialogGroupBody {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  row-gap: var(--spacing-s);
}

.emoji {
  position: relative;

  &:hover {
    animation: scale 0.4s ease-in-out;
  }
}
</style>
