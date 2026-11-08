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
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  // TODO [Star]: storeToRefs will be used when isSharingOwnDeskSound is reimplemented
  // import { storeToRefs } from 'pinia';
  import size from 'lodash/size';
  import {
    // TODO [Star]: Ui3nButton will be used when desk sound controls are reimplemented
    // Ui3nButton,
    Ui3nButton,
    Ui3nIcon,
    Ui3nRipple as vUi3nRipple,
    Ui3nTooltip,
    type Nullable,
  } from '@v1nt1248/3nclient-lib';
  import type { OwnScreen } from '@video/common/types';
  import VideoStream from '@video/common/components/video-stream.vue';

  interface PeerShared {
    peerAddr: string;
    peerName: string;
    stream: MediaStream;
  }

  const props = defineProps<{
    things: (OwnScreen | PeerShared)[];
    /** Remove own screen share by source ID */
    removeOwnScreen?: (srcId: string) => void;
  }>();

  const emit = defineEmits<{
    (e: 'removeScreen', srcId: string): void;
  }>();

  const { t } = useI18n();

  // TODO [Star]: isSharingOwnDeskSound will be reimplemented for Star architecture screen sharing
  // const { isSharingOwnDeskSound } = storeToRefs(streamsStore);
  // TODO [Star]: setOwnDeskSoundSharing will be reimplemented for Star architecture
  // const { setOwnDeskSoundSharing } = streamsStore;

  function handleRemoveScreen(item: OwnScreen | PeerShared) {
    const srcId = (item as OwnScreen).srcId;
    if (srcId) {
      if (props.removeOwnScreen) {
        props.removeOwnScreen(srcId);
      } else {
        emit('removeScreen', srcId);
      }
    }
  }

  const currentSharedItem = ref(0);

  const processedSharedItems = computed(() =>
    props.things.map(thing => ({
      ...thing,
      id: (thing as OwnScreen).srcId || (thing as PeerShared).peerAddr,
    })),
  );

  // A live computed into the store data, NOT a snapshot: the selected item
  // used to be a `{...thing}` copy refreshed only when the LIST LENGTH
  // changed, so a replaced MediaStream on the same participant (renegotiation
  // re-delivers the screen under a new stream object) left <video> playing a
  // stream whose track was already gone - correct title, black picture.
  const selectedSharedItem = computed<Nullable<OwnScreen | PeerShared>>(() => {
    const items = processedSharedItems.value;
    if (items.length === 0) {
      return null;
    }
    const index = Math.min(currentSharedItem.value, items.length - 1);
    return items[index];
  });

  function selectSharedItem(index: number) {
    currentSharedItem.value = index;
  }

  watch(
    () => size(processedSharedItems.value),
    (val, oldVal) => {
      if (val !== oldVal && val > 0) {
        selectSharedItem(0);
      }
    },
  );
</script>

<template>
  <div
    :class="[
      $style.viewSharedThings,
      // TODO [Star]: Re-enable when isSharingOwnDeskSound is reimplemented
      // isSharingOwnDeskSound && $style.withDeskSound,
      size(things) > 1 && $style.withTabs,
    ]"
  >
    <!-- TODO [Star]: Re-enable desk sound UI when reimplemented for Star architecture -->
    <!--
    <div
      v-if="isSharingOwnDeskSound"
      :class="$style.title"
    >
    -->
    <div
      v-if="false"
      :class="$style.title"
    >
      <div :class="$style.name">
        <ui3n-icon
          icon="round-volume-up"
          width="16"
          height="16"
        />

        <span>{{ t('call.sharing.desktop_sound') }}</span>
      </div>

      <!-- TODO [Star]: Re-enable when setOwnDeskSoundSharing is reimplemented -->
      <!--
      <ui3n-button
        type="icon"
        size="small"
        color="var(--color-bg-block-primary-default)"
        icon="round-close"
        icon-color="var(--color-icon-table-primary-default)"
        icon-size="20"
        @click.stop.prevent="setOwnDeskSoundSharing(false)"
      />
      -->
    </div>

    <div
      v-if="size(things) > 1"
      :class="$style.tabs"
    >
      <div
        v-for="(item, index) in processedSharedItems"
        :key="item.id"
        v-ui3n-ripple
        :class="[$style.tab, index === currentSharedItem && $style.selected]"
        @click.stop.prevent="selectSharedItem(index)"
      >
        <ui3n-tooltip
          :content="(item as OwnScreen).name || (item as PeerShared).peerAddr"
          placement="right"
          position-strategy="fixed"
        >
          <div :class="$style.tabBody">
            {{ index }}
          </div>
        </ui3n-tooltip>
      </div>
    </div>

    <div :class="$style.body">
      <div :class="[$style.title, $style.withPadding, $style.selected]">
        <div :class="$style.name">
          {{ (selectedSharedItem as OwnScreen)?.name || (selectedSharedItem as PeerShared)?.peerName }}
        </div>

        <ui3n-button
          v-if="(selectedSharedItem as OwnScreen)?.srcId"
          type="icon"
          size="small"
          color="transparent"
          icon="round-close"
          icon-size="20"
          icon-color="var(--color-icon-table-primary-default)"
          @click.stop.prevent="handleRemoveScreen(selectedSharedItem!)"
        />
      </div>

      <!-- Keyed by the stream's id: a participant whose MediaStream object is
           replaced (renegotiation) must remount the <video>, or it keeps
           playing the dead stream. -->
      <video-stream
        v-if="selectedSharedItem"
        :key="selectedSharedItem.stream.id"
        :stream="selectedSharedItem.stream"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .viewSharedThings {
    position: relative;
    width: 100%;
    height: 100%;
    padding-left: var(--spacing-l);
    background-color: var(--color-bg-block-primary-default);
    color: var(--color-text-block-primary-default);

    &.withDeskSound {
      padding-top: var(--spacing-xl);

      .tabs {
        top: var(--spacing-xl);
      }
    }

    &.withTabs {
      padding-left: var(--spacing-xl);
    }
  }

  .title {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: var(--spacing-xl);
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--font-16);
    font-weight: 600;
    border-bottom: 1px solid var(--color-border-block-primary-default);
  }

  .withPadding {
    padding: 0 var(--spacing-m);
  }

  .name {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .tabs {
    position: absolute;
    left: 0;
    width: var(--spacing-xl);
    top: 0;
    bottom: 0;
    border-right: 1px solid var(--color-border-block-primary-default);
  }

  .selected {
    background-color: var(--color-bg-control-primary-hover);
  }

  .tab {
    position: relative;
    width: var(--spacing-xl);
    height: var(--spacing-xl);
    border-radius: var(--spacing-xs);
    overflow: hidden;

    &:hover {
      background-color: var(--color-bg-control-primary-hover);
    }

    &:not(.selectedTab) {
      cursor: pointer;
    }

    & > div {
      position: relative;
      width: 100%;
      height: 100%;
    }
  }

  .tabBody {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: var(--font-16);
    font-weight: 600;
  }

  .body {
    position: relative;
    width: 100%;
    height: 100%;
    padding-top: var(--spacing-l);
  }
</style>
