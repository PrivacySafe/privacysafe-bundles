<!--
 Copyright (C) 2024 - 2025 3NSoft Inc.

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
  import {
    Ui3nDialog,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
    Ui3nSwitch,
  } from '@v1nt1248/3nclient-lib';
  import type { SharedStream } from '@video/common/types';
  import { useScreenShareChoiceDialog } from './sharing-choice-dialog';
  import SharePreview from '@video/desktop/components/share-preview.vue';

  export interface ScreenShareChoicesProps {
    initiallyShared: SharedStream[];
    initialDeskSoundShared: boolean;
    dialogProps?: Ui3nDialogComponentProps<{ selected: SharedStream[]; selectedDeskSound: boolean }>;
  }

  export interface ScreenShareChoicesEvents {
    (
      event: 'action',
      value: { event: Ui3nDialogEvent; data?: { selected: SharedStream[]; selectedDeskSound: boolean } },
    ): void;
  }

  const props = defineProps<ScreenShareChoicesProps>();
  const emits = defineEmits<ScreenShareChoicesEvents>();

  const { t } = useI18n();

  const {
    data,
    activeSrcId,
    isAudioCaptureAvailable,
    selectAudio,
    windowChoices,
    screenChoices,
    onOptionSelectionChange,
    onDeskSoundChange,
  } = useScreenShareChoiceDialog(props);
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    :data="data"
    @action="emits('action', $event)"
  >
    <template #body>
      <div :class="$style.shareOptions">
        <div :class="$style.body">
          <div
            v-if="isAudioCaptureAvailable"
            :class="$style.soundShare"
          >
            <ui3n-switch
              v-model="selectAudio"
              size="24"
              @change="onDeskSoundChange"
            >
              {{ t('call.sharing.settings.sound_share') }}
            </ui3n-switch>
          </div>

          <div :class="$style.block">
            <div :class="$style.blockTitle">
              {{ t('call.sharing.settings.screens_title') }}:
            </div>

            <share-preview
              v-for="screen in screenChoices"
              :key="screen.srcId"
              :opts="screen"
              :active-src-id="activeSrcId"
              @selected="v => onOptionSelectionChange(screen, v)"
            />
          </div>

          <div :class="$style.block">
            <div :class="$style.blockTitle">
              {{ t('call.sharing.settings.windows_title') }}:
            </div>

            <share-preview
              v-for="frame in windowChoices"
              :key="frame.srcId"
              :opts="frame"
              :active-src-id="activeSrcId"
              @selected="v => onOptionSelectionChange(frame, v)"
            />
          </div>
        </div>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .shareOptions {
    position: relative;
    width: 100%;
    height: 100%;
    padding: var(--spacing-m);
  }

  .body {
    position: relative;
    width: 100%;
    height: 100%;
    overflow-y: auto;
  }

  .soundShare {
    margin-bottom: var(--spacing-m);
  }

  .block {
    position: relative;
    width: 100%;
    padding-top: var(--spacing-xl);
    margin-bottom: var(--spacing-m);
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: var(--spacing-m);
  }

  .blockTitle {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: var(--spacing-xl);
    font-size: var(--font-16);
    font-weight: 600;
    line-height: var(--spacing-l);
    color: var(--color-text-control-primary-default);
  }
</style>
