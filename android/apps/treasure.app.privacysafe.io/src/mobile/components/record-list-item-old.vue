<!--
 Copyright (C) 2026 3NSoft Inc.

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
  import { computed, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import isEmpty from 'lodash/isEmpty';
  import { copyToClipboard, generateColor } from '@v1nt1248/3nclient-lib/utils';
  import { Ui3nIcon, Ui3nRipple as vUi3nRipple } from '@v1nt1248/3nclient-lib';
  import type { SyncType, TreasureRecord, TreasurePasswordRecord, TreasureCardRecord } from '@shared/@types';
  import { DEFAULT_GROUP, RECORD_TYPE } from '@shared/constants';
  import { useRecordStore } from '@/common/stores/record.store';
  import ImagesPlaceholder from '@/common/components/images-placeholder.vue';

  const props = defineProps<{
    item: TreasureRecord;
    syncProcess?: { type: SyncType; value: number };
    selectedGroup: string;
  }>();
  const emits = defineEmits<{
    (event: 'open', value: TreasureRecord): void;
    (event: 'set:favorite', value: TreasureRecord): void;
    (event: 'show:images', value: string[]): void;
  }>();

  const { t } = useI18n();

  const { addRecordToRecent } = useRecordStore();

  const thresholdX = 20;
  const thresholdY = 10;
  const touchData = ref({
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
  });

  const isShiftedRight = ref(false);
  const isShiftedLeft = ref(false);

  const lockChanges = computed(() => !!props.syncProcess);
  const iconStyle = computed(() => {
    const label = 'images' in props.item ? props.item.resource : props.item.name || props.item.resource;

    return { backgroundColor: generateColor(label) };
  });

  function onClick(evt: MouseEvent) {
    const delta = Math.abs(touchData.value.endX - touchData.value.startX);
    if (delta > thresholdX) {
      evt.stopPropagation();
      return;
    }

    emits('open', props.item);
  }

  function onMousedown(evt: PointerEvent) {
    (evt.currentTarget as HTMLElement).setPointerCapture(evt.pointerId);
    touchData.value.startX = evt.clientX;
    touchData.value.startY = evt.clientY;
  }

  function onMouseUp(evt: PointerEvent) {
    touchData.value.endX = evt.clientX;
    touchData.value.endY = evt.clientY;
    (evt.currentTarget as HTMLElement).releasePointerCapture(evt.pointerId);
    handleGesture();
  }

  function handleGesture() {
    const deltaX = touchData.value.endX - touchData.value.startX;
    const deltaY = Math.abs(touchData.value.endY - touchData.value.startY);
    if (Math.abs(deltaX) > thresholdX && deltaY < thresholdY) {
      if (deltaX > 0) {
        if (isShiftedLeft.value) {
          isShiftedLeft.value = false;
        } else {
          isShiftedRight.value = true;
        }
      } else {
        if (isShiftedRight.value) {
          isShiftedRight.value = false;
        } else {
          isShiftedLeft.value = true;
        }
      }
    }
  }

  function setFavorite() {
    isShiftedRight.value = false;
    emits('set:favorite', props.item);
  }

  async function copyText(text: string) {
    isShiftedLeft.value = false;
    if (lockChanges.value) {
      return;
    }

    await copyToClipboard(text);

    if (props.selectedGroup !== DEFAULT_GROUP.RECENT) {
      await addRecordToRecent(props.item.id);
    }
  }

  async function showImages() {
    if (props.selectedGroup !== DEFAULT_GROUP.RECENT) {
      await addRecordToRecent(props.item.id);
    }

    isShiftedLeft.value = false;
    isShiftedRight.value = false;
    emits('show:images', (props.item as TreasureCardRecord).images);
  }
</script>

<template>
  <div
    :class="[
      $style.recordListItemWrapper,
      isShiftedLeft && $style.shiftedLeft,
      isShiftedRight && $style.shiftedRight,
    ]"
  >
    <div
      v-ui3n-ripple
      :class="$style.favoriteBlock"
      @click="setFavorite"
    >
      <ui3n-icon
        icon="round-bookmark"
        :color="
          item.isFavorite ? 'var(--color-icon-table-accent-unselected)' : 'var(--color-icon-table-accent-selected)'
        "
        size="24"
      />

      <span>{{ item.isFavorite ? t('list.removeFromFavorites') : t('list.addToFavorites') }}</span>
    </div>

    <div
      :class="[$style.recordListItem, lockChanges && $style.locked]"
      @pointerdown.capture="onMousedown"
      @pointerup.capture="onMouseUp"
      @click="onClick"
    >
      <div
        :class="$style.icon"
        :style="iconStyle"
      >
        {{ ((item as TreasurePasswordRecord).name || item.resource)[0] }}

        <div
          v-if="item.source"
          :class="$style.duplicate"
        >
          <ui3n-icon
            icon="round-warning"
            size="14"
            color="var(--warning-content-default)"
          />
        </div>
      </div>

      <div :class="$style.itemInfo">
        <span :class="$style.name">{{ 'images' in item ? item.resource : item.name || item.resource }}</span>
        <span :class="$style.resource">{{ item.resource }}</span>
        <span
          v-if="(item as TreasurePasswordRecord).username"
          :class="$style.username"
        >
          {{ (item as TreasurePasswordRecord).username }}
        </span>
      </div>

      <ui3n-icon
        v-if="lockChanges"
        icon="round-lock"
        size="12"
        color="var(--color-icon-control-warning-default)"
        :class="$style.infoIcon"
      />

      <ui3n-icon
        v-if="!lockChanges"
        icon="round-bookmark"
        size="12"
        :color="
          item.isFavorite ? 'var(--color-icon-table-accent-selected)' : 'var(--color-icon-table-accent-unselected)'
        "
        :class="[$style.infoIcon, item.isFavorite && $style.iconSelected]"
      />
    </div>

    <div :class="[$style.copyBlock, item.type === RECORD_TYPE.CARD && $style.copyBlockCard]">
      <template v-if="item.type === RECORD_TYPE.CARD">
        <images-placeholder
          :images="item.images"
          :displayed-quantity="2"
          :disabled="isEmpty(item.images)"
          @click.stop.prevent="() => showImages()"
        />
      </template>

      <template v-else>
        <div
          v-if="(item as TreasurePasswordRecord).username"
          v-ui3n-ripple
          :class="$style.copyBlockItem"
          @click="() => copyText((item as TreasurePasswordRecord).username)"
        >
          <ui3n-icon
            icon="round-content-copy"
            color="var(--color-icon-table-accent-selected)"
            size="24"
          />

          <span>{{ t('list.copyUsername') }}</span>
        </div>

        <div
          v-if="(item as TreasurePasswordRecord).password"
          v-ui3n-ripple
          :class="$style.copyBlockItem"
          @click="() => copyText((item as TreasurePasswordRecord).password)"
        >
          <ui3n-icon
            icon="key-vertical-outline"
            color="var(--color-icon-table-accent-selected)"
            size="24"
          />

          <span>{{ t('list.copyRecord') }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins' as mixins;

  .recordListItemWrapper {
    position: relative;
    display: flex;
    justify-content: flex-start;
    align-items: stretch;
    height: 72px;
    width: fit-content;
    border-bottom: 1px solid var(--color-border-block-primary-default);
    transition: all 0.25s ease-in-out;
    overflow: hidden;

    &.shiftedRight {
      .favoriteBlock,
      .recordListItem,
      .copyBlock {
        left: 0;
      }
    }

    &.shiftedLeft {
      .favoriteBlock,
      //.recordListItem,
      .copyBlock {
        left: -192px;
      }
    }
  }

  .favoriteBlock {
    position: relative;
    width: 64px;
    min-width: 64px;
    height: 100%;
    left: -64px;
    display: flex;
    flex-direction: column;
    row-gap: var(--spacing-xs);
    justify-content: center;
    align-items: center;
    background-color: var(--color-border-button-secondary-focused);
    transition: all 0.25s ease-in-out;

    span {
      display: block;
      width: 100%;
      font-size: var(--font-8);
      font-weight: 700;
      line-height: var(--font-11);
      padding: 0 var(--spacing-s);
      text-align: center;
      color: var(--color-text-table-accent-default);
    }
  }

  .recordListItem {
    --name-icon-size: 36px;

    position: relative;
    left: -64px;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    width: 100vw;
    min-width: 100vw;
    height: 100%;
    padding: 0 var(--spacing-m);
    user-select: none;
    -webkit-user-drag: none;
    cursor: pointer;
    transition: all 0.25s ease-in-out;

    &.locked {
      pointer-events: none;
      cursor: none;
      opacity: 0.7;
    }

    &:not(.locked):hover {
      .infoIcon {
        opacity: 1;
        cursor: pointer;
      }
    }

    .icon {
      position: relative;
      width: var(--name-icon-size);
      min-width: var(--name-icon-size);
      height: var(--name-icon-size);
      border-radius: 50%;
      display: flex;
      justify-content: center;
      align-items: center;
      font-style: var(--font-14);
      font-weight: 700;
      color: #fff;
      text-transform: uppercase;
    }

    .duplicate {
      position: absolute;
      width: 18px;
      height: 18px;
      top: -4px;
      right: -6px;
      background-color: var(--color-bg-block-primary-default);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1;
      border-radius: 50%;
      border: 1px solid var(--color-border-block-primary-default);
    }

    .infoIcon {
      position: absolute;
      left: 2px;
      top: 30px;

      &:not(.iconSelected) {
        opacity: 0;
      }

      &.iconSelected {
        opacity: 1;
      }
    }

    .itemInfo {
      position: relative;
      width: calc(100% - var(--name-icon-size) - var(--spacing-s));

      span {
        display: block;
      }

      .name {
        font-size: var(--font-14);
        font-weight: 600;
        line-height: var(--font-20);
        color: var(--color-text-table-primary-default);
      }

      .resource {
        font-size: var(--font-12);
        font-weight: 700;
        line-height: var(--font-16);
        color: var(--color-text-table-secondary-default);
      }

      .username {
        font-size: var(--font-14);
        font-weight: 400;
        line-height: var(--font-18);
        color: var(--color-text-table-primary-default);
      }
    }
  }

  .copyBlock {
    position: relative;
    width: 128px;
    min-width: 128px;
    height: 100%;
    left: -64px;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: var(--color-border-button-secondary-focused);
    transition: all 0.25s ease-in-out;

    .copyBlockItem {
      position: relative;
      width: 64px;
      height: 100%;
      display: flex;
      flex-direction: column;
      row-gap: var(--spacing-xs);
      justify-content: center;
      align-items: center;

      span {
        display: block;
        width: 100%;
        font-size: var(--font-8);
        font-weight: 700;
        line-height: var(--font-11);
        padding: 0 var(--spacing-s);
        text-align: center;
        color: var(--color-text-table-accent-default);
      }
    }

    &.copyBlockCard {
      padding: 0 var(--spacing-s);

      & > div {
        --img-placeholder-size: 32px !important;

        span {
          font-size: var(--font-14) !important;
        }
      }
    }
  }
</style>
