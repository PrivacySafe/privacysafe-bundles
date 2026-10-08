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
  import { Ui3nIcon, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import { DEFAULT_GROUP, RECORD_TYPE } from '@shared/constants.ts';
  import type { SyncType, TreasureBankCardRecord, TreasureCardRecord, TreasureRecord } from '@shared/@types';
  import { useRecordStore } from '@/common/stores/record.store';
  import RecordSyncStatus from '@/common/components/record-sync-status/record-sync-status.vue';
  import ImagesPlaceholder from '@/common/components/images-placeholder.vue';

  const props = defineProps<{
    row: TreasureRecord;
    columnStyle?: Record<string, Record<string, string>>;
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

  const lockChanges = computed(() => !!props.syncProcess);

  const rowResource = computed(() => {
    if ('exp' in (props.row as TreasureBankCardRecord)) {
      const itemResourceParsed = props.row.resource.split(' ');
      const updatedResourceData = itemResourceParsed
        .map((part, index) => (index === 0 || index === itemResourceParsed.length - 1 ? part : '****'))
        .join(' ');
      return `${updatedResourceData}`;
    }

    return props.row.resource;
  });

  const nameIconStyle = computed(() => ({
    backgroundColor: generateColor(props.row.name || props.row.resource),
  }));

  function getFieldStyle(field: keyof TreasureRecord | 'sync'): Record<string, string> {
    const style = props.columnStyle ? props.columnStyle[field] || { width: 'auto' } : { width: 'auto' };
    return { width: style.width, minWidth: style.width };
  }

  async function copyValue(value: string) {
    if (lockChanges.value) {
      return;
    }

    await copyToClipboard(value);

    await addRecordToRecent(props.row.id);
    if (props.selectedGroup === DEFAULT_GROUP.RECENT) {
      const container = document.getElementById('treasuresTable');

      if (container) {
        container.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }

  async function showImages() {
    if (props.selectedGroup !== DEFAULT_GROUP.RECENT) {
      await addRecordToRecent(props.row.id);
    }
    emits('show:images', (props.row as TreasureCardRecord).images);
  }
</script>

<template>
  <div :class="[$style.row, lockChanges && $style.locked]">
    <div
      :class="$style.name"
      :style="getFieldStyle('name')"
      @click.stop.prevent="() => !lockChanges && emits('open', props.row)"
    >
      <div
        :class="$style.nameIcon"
        :style="nameIconStyle"
      >
        {{ (row.name || row.resource)[0] }}

        <ui3n-tooltip
          v-if="row.source"
          :content="t('treasuresTable.row.duplicateTooltip')"
          position-strategy="fixed"
          placement="top-start"
        >
          <div :class="$style.duplicate">
            <ui3n-icon
              icon="round-warning"
              size="14"
              color="var(--warning-content-default)"
            />
          </div>
        </ui3n-tooltip>
      </div>

      <div :class="$style.nameInfo">
        <span :class="$style.nameText">{{ row.name || row.resource }}</span>
        <span
          v-if="row.resource"
          :class="$style.resource"
        >
          <template v-if="row.type === RECORD_TYPE.BANK_CARD">
            <span :class="[$style.cardField, $style.cardNumber]">
              <span :class="$style.cardFieldPlaceholder">
                {{ rowResource }}
              </span>

              <button
                :class="$style.cardFieldValue"
                @click.stop.prevent="() => copyValue(row.resource!)"
              >
                <span :class="$style.cardFieldTextNormal">{{ rowResource }}</span>
                <span :class="$style.cardFieldTextActive">{{ t('treasuresTable.row.copiedBtn') }}</span>
              </button>
            </span>

            <span :class="[$style.cardField, $style.cardExp]">
              <span :class="$style.cardFieldPlaceholder">
                {{ (row as TreasureBankCardRecord).exp }}
              </span>

              <button
                :class="$style.cardFieldValue"
                @click.stop.prevent="() => copyValue((row as TreasureBankCardRecord).exp)"
              >
                <span :class="$style.cardFieldTextNormal">{{ (row as TreasureBankCardRecord).exp }}</span>
                <span :class="$style.cardFieldTextActive">{{ t('treasuresTable.row.copiedBtn') }}</span>
              </button>
            </span>
          </template>

          <template v-else>
            {{ rowResource }}
          </template>
        </span>
      </div>
    </div>

    <div
      :class="$style.sync"
      :style="getFieldStyle('sync')"
    >
      <record-sync-status
        :record="row"
        :sync-process="syncProcess"
      />
    </div>

    <div
      :class="$style.username"
      :style="getFieldStyle('username')"
    >
      <template v-if="row.type === 'card'">
        <images-placeholder
          :images="row.images"
          @click.stop.prevent="() => showImages()"
        />
      </template>

      <template v-else>
        <span :class="$style.usernamePlaceholder">
          {{ row.username }}
        </span>

        <button
          :class="$style.usernameValue"
          @click.stop.prevent="() => copyValue(row.username!)"
        >
          <span :class="$style.usernameTextNormal">{{ row.username }}</span>
          <span :class="$style.usernameTextActive">{{ t('treasuresTable.row.copiedBtn') }}</span>
        </button>
      </template>
    </div>

    <div
      :class="$style.password"
      :style="getFieldStyle('password')"
    >
      <template v-if="row.type !== 'card'">
        <span :class="$style.passwordPlaceholder">✭✭✭✭✭✭✭✭✭✭</span>

        <button
          :class="$style.passwordValue"
          @click.stop.prevent="() => copyValue(row.password!)"
        >
          <span :class="$style.passwordTextNormal">✭✭✭✭✭✭✭✭✭✭</span>
          <span :class="$style.passwordTextActive">{{ t('treasuresTable.row.copiedBtn') }}</span>
        </button>
      </template>
    </div>

    <ui3n-icon
      v-if="lockChanges"
      icon="round-lock"
      size="12"
      color="var(--color-icon-control-warning-default)"
      :class="$style.icon"
    />

    <ui3n-icon
      v-if="!lockChanges"
      icon="round-bookmark"
      size="12"
      :color="
        row.isFavorite ? 'var(--color-icon-table-accent-selected)' : 'var(--color-icon-table-accent-unselected)'
      "
      :class="[$style.icon, row.isFavorite && $style.iconSelected]"
      @click.stop.prevent="() => emits('set:favorite', row)"
    />
  </div>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins' as mixins;

  .row {
    --row-height: 52px;
    --row-icon-size: 36px;

    position: relative;
    width: 100%;
    height: var(--row-height);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    padding-left: var(--spacing-m);
    cursor: pointer;
    user-select: none;

    &.locked {
      pointer-events: none;
      cursor: none;
      opacity: 0.7;
    }

    &:not(.locked):hover {
      .icon {
        opacity: 1;
        cursor: pointer;
      }
    }
  }

  .name {
    display: flex;
    width: 100%;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);

    .nameIcon {
      position: relative;
      width: var(--row-icon-size);
      min-width: var(--row-icon-size);
      height: var(--row-icon-size);
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

    .nameInfo {
      position: relative;
      width: calc(100% - var(--row-icon-size) - var(--spacing-s));

      span {
        display: inline-block;
        width: 100%;
        @include mixins.text-overflow-ellipsis();
      }

      .nameText {
        font-size: var(--font-14);
        font-weight: 500;
        line-height: var(--font-20);
        color: var(--color-text-table-primary-default);
      }

      .resource {
        display: flex;
        justify-content: flex-start;
        align-items: center;
        font-size: var(--font-12);
        font-weight: 600;
        color: var(--color-text-table-secondary-default);
        column-gap: var(--spacing-m);

        .cardField {
          --car-field-padding: 2px var(--spacing-xs);

          width: fit-content;
          transition: all 0.25s ease-in-out;

          &.cardNumber {
            min-width: 128px;
          }

          &.cardExp {
            min-width: 48px;
          }

          .cardFieldPlaceholder {
            display: block;
            line-height: 1;
            padding: var(--car-field-padding);
          }

          .cardFieldValue {
            display: none;
          }

          &:hover {
            .cardFieldPlaceholder {
              display: none;
            }

            .cardFieldValue {
              display: block;
              position: relative;
              width: 100%;
              padding: var(--car-field-padding);
              color: var(--color-text-table-primary-default);
              background-color: var(--color-bg-table-cell-default);
              border-radius: var(--spacing-xs);
              text-align: left;
              border: none;
              outline: none;
              font-family: Inter, system-ui, sans-serif;
              font-size: var(--font-12);
              font-weight: 600;
              line-height: 1;
              cursor: pointer;

              .cardFieldTextNormal {
                display: block;
              }

              .cardFieldTextActive {
                display: none;
              }

              &:active {
                text-align: center;
                background-color: var(--color-bg-control-primary-pressed);

                .cardFieldTextNormal {
                  display: none;
                }

                .cardFieldTextActive {
                  display: block;
                }
              }
            }
          }
        }
      }
    }
  }

  .sync,
  .username,
  .password {
    display: flex;
    width: 100%;
    padding: 0 var(--spacing-xs);
    justify-content: flex-start;
    align-items: center;
  }

  .username,
  .password {
    font-size: var(--font-14);
    font-weight: 400;
    line-height: 1;
    color: var(--color-text-table-primary-default);
  }

  .username {
    padding-right: var(--spacing-s);
    transition: all 0.25s ease-in-out;

    .usernamePlaceholder {
      display: block;
      line-height: 1;
      padding-left: var(--spacing-s);
    }

    .usernameValue {
      display: none;
    }

    &:hover {
      .usernamePlaceholder {
        display: none;
      }

      .usernameValue {
        display: block;
        position: relative;
        width: 100%;
        padding: var(--spacing-xs) var(--spacing-s);
        color: var(--color-text-table-primary-default);
        background-color: var(--color-bg-table-cell-default);
        border-radius: var(--spacing-xs);
        text-align: left;
        border: none;
        outline: none;
        font-family: Inter, system-ui, sans-serif;
        font-size: var(--font-14);
        line-height: 1;
        cursor: pointer;

        .usernameTextNormal {
          display: block;
        }

        .usernameTextActive {
          display: none;
        }

        &:active {
          text-align: center;
          background-color: var(--color-bg-control-primary-pressed);

          .usernameTextNormal {
            display: none;
          }

          .usernameTextActive {
            display: block;
          }
        }
      }
    }
  }

  .password {
    padding-right: var(--spacing-s);
    transition: all 0.25s ease-in-out;

    .passwordPlaceholder {
      display: block;
      padding-left: var(--spacing-s);
    }

    .passwordValue {
      display: none;
    }

    &:hover {
      .passwordPlaceholder {
        display: none;
      }

      .passwordValue {
        display: block;
        position: relative;
        width: 100%;
        padding: var(--spacing-xs) var(--spacing-s);
        color: var(--color-text-table-primary-default);
        background-color: var(--color-bg-table-cell-default);
        border-radius: var(--spacing-xs);
        font-size: var(--font-14);
        text-align: left;
        border: none;
        outline: none;
        cursor: pointer;

        .passwordTextNormal {
          display: block;
        }

        .passwordTextActive {
          display: none;
        }

        &:active {
          text-align: center;
          background-color: var(--color-bg-control-primary-pressed);

          .passwordTextNormal {
            display: none;
          }

          .passwordTextActive {
            display: block;
          }
        }
      }
    }
  }

  .icon {
    position: absolute;
    left: 2px;
    top: 20px;
    z-index: 2;

    &:not(.iconSelected) {
      opacity: 0;
    }

    &.iconSelected {
      opacity: 1;
    }
  }
</style>
