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
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { copyToClipboard, generateColor } from '@v1nt1248/3nclient-lib/utils';
  import { Ui3nIcon, Ui3nRipple as vUi3nRipple } from '@v1nt1248/3nclient-lib';
  import { useRecordStore } from '@/common/stores/record.store';
  import type {
    SyncType,
    TreasureBankCardRecord,
    TreasureCardRecord,
    TreasurePasswordRecord,
    TreasureRecord,
  } from '@shared/@types';
  import { DEFAULT_GROUP, RECORD_TYPE } from '@shared/constants.ts';
  import isEmpty from 'lodash/isEmpty';
  import ImagesPlaceholder from '@/common/components/images-placeholder.vue';

  const props = defineProps<{
    item: TreasureRecord;
    syncProcess?: { type: SyncType; value: number };
    selectedGroup: string;
    isActive?: boolean;
  }>();

  const emits = defineEmits<{
    (event: 'toggle:active'): void;
    (event: 'open', value: TreasureRecord): void;
    (event: 'set:favorite', value: TreasureRecord): void;
    (event: 'show:images', value: string[]): void;
  }>();

  const { t } = useI18n();

  const { addRecordToRecent } = useRecordStore();

  const lockChanges = computed(() => !!props.syncProcess);
  const iconStyle = computed(() => {
    const label = 'images' in props.item ? props.item.resource : props.item.name || props.item.resource;

    return { backgroundColor: generateColor(label) };
  });

  const itemResource = computed(() => {
    if ('exp' in (props.item as TreasureBankCardRecord)) {
      const itemResourceParsed = props.item.resource.split(' ');
      const updatedResourceData = itemResourceParsed
        .map((part, index) => (index === 0 || index === itemResourceParsed.length - 1 ? part : '****'))
        .join(' ');
      return `${updatedResourceData} [${(props.item as TreasureBankCardRecord).exp}]`;
    }

    return props.item.resource;
  });

  function toggleActionsBlock() {
    emits('toggle:active');
  }

  async function copyText(text: string) {
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

    emits('show:images', (props.item as TreasureCardRecord).images);
  }
</script>

<template>
  <div :class="[$style.recordListItem, isActive && $style.expanded]">
    <div
      v-ui3n-ripple="{ color: 'var(--color-border-button-secondary-focused)' }"
      :class="[$style.content, lockChanges && $style.locked]"
      @click.stop.prevent="toggleActionsBlock"
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
        <span :class="$style.resource">{{ itemResource }}</span>
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

    <transition>
      <div
        v-if="isActive"
        :class="$style.actions"
      >
        <div
          v-ui3n-ripple
          :class="$style.actionBtn"
          @click.stop.prevent="emits('open', item)"
        >
          <ui3n-icon
            icon="round-edit"
            color="var(--color-icon-table-accent-selected)"
            size="24"
          />

          <span>{{ t('list.editRecord') }}</span>
        </div>

        <div :class="$style.buttonsBlock">
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
              v-ui3n-ripple
              :class="$style.actionBtn"
              @click.stop.prevent="emits('set:favorite', item)"
            >
              <ui3n-icon
                icon="round-bookmark"
                :color="
                  item.isFavorite
                    ? 'var(--color-icon-table-accent-unselected)'
                    : 'var(--color-icon-table-accent-selected)'
                "
                size="24"
              />

              <span>{{ item.isFavorite ? t('list.removeFromFavorites') : t('list.addToFavorites') }}</span>
            </div>

            <div
              v-if="item.type === RECORD_TYPE.BANK_CARD"
              v-ui3n-ripple
              :class="$style.actionBtn"
              @click.stop.prevent="() => copyText((item as TreasureBankCardRecord).resource)"
            >
              <ui3n-icon
                icon="round-credit-card"
                color="var(--color-icon-table-accent-selected)"
                size="24"
              />

              <span>{{ t('list.copyCardNumber') }}</span>
            </div>

            <div
              v-if="(item as TreasurePasswordRecord).username"
              v-ui3n-ripple
              :class="$style.actionBtn"
              @click.stop.prevent="() => copyText((item as TreasurePasswordRecord).username)"
            >
              <ui3n-icon
                icon="round-content-copy"
                color="var(--color-icon-table-accent-selected)"
                size="24"
              />

              <span>
                {{ item.type === RECORD_TYPE.BANK_CARD ? t('list.copyCardHolder') : t('list.copyUsername') }}
              </span>
            </div>

            <div
              v-if="item.type === RECORD_TYPE.BANK_CARD"
              v-ui3n-ripple
              :class="$style.actionBtn"
              @click.stop.prevent="() => copyText((item as TreasureBankCardRecord).exp)"
            >
              <ui3n-icon
                icon="round-calendar-view-month"
                color="var(--color-icon-table-accent-selected)"
                size="24"
              />

              <span>{{ t('list.copyCardExp') }}</span>
            </div>

            <div
              v-if="(item as TreasurePasswordRecord).password"
              v-ui3n-ripple
              :class="$style.actionBtn"
              @click.stop.prevent="() => copyText((item as TreasurePasswordRecord).password)"
            >
              <ui3n-icon
                icon="key-vertical-outline"
                color="var(--color-icon-table-accent-selected)"
                size="24"
              />

              <span>
                {{ item.type === RECORD_TYPE.BANK_CARD ? t('list.copyCardCvv') : t('list.copyPassword') }}
              </span>
            </div>
          </template>
        </div>
      </div>
    </transition>
  </div>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins' as mixins;

  .recordListItem {
    --item-min-height: 72px;
    --name-icon-size: 36px;

    position: relative;
    width: calc(100% - var(--spacing-ml));
    background-color: var(--color-bg-block-primary-default);
    overflow: hidden;
    transition: height 0.25s ease-in-out;
    margin: 0 auto 12px var(--spacing-s);
    border-radius: var(--spacing-m);
    box-shadow:
      3px 3px 5px 2px var(--shadow-key-2),
      -1px -1px 5px 2px var(--shadow-key-2);

    &.expanded {
      background-color: var(--color-bg-control-secondary-default);

      .content {
        border-bottom: 1px solid var(--color-border-block-primary-hover);
      }
    }
  }

  .content {
    display: flex;
    width: 100%;
    height: var(--item-min-height);
    padding: 0 var(--spacing-m);
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    user-select: none;
    cursor: pointer;
    overflow: hidden;

    &.locked {
      pointer-events: none;
      cursor: none;
      opacity: 0.7;
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

  .actions {
    display: flex;
    width: 100%;
    height: var(--item-min-height);
    justify-content: space-between;
    align-items: center;
    overflow: hidden;

    .buttonsBlock {
      position: relative;
      display: flex;
      height: 100%;
      justify-content: flex-start;
      align-items: center;
      overflow: hidden;
    }

    .actionBtn {
      position: relative;
      display: flex;
      min-width: 48px;
      max-width: 64px;
      height: 100%;
      flex-direction: column;
      justify-content: flex-start;
      align-items: center;
      row-gap: var(--spacing-xs);
      padding-top: 12px;
      cursor: pointer;
      overflow: hidden;

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
  }
</style>
