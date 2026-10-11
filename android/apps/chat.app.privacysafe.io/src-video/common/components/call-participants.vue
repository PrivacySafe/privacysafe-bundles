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
  import { Ui3nButton, Ui3nIcon, Ui3nChip } from '@v1nt1248/3nclient-lib';
  import { useAppStore } from '@video/common/store/app.store';
  import ChatAvatar from '@main/common/components/chat/chat-avatar.vue';
  import type { PeerVideo } from '~/index';
  import type { ConnectingPeer } from '@video/common/types';

  const props = defineProps<{
    peerVideos: PeerVideo[];
    connectingPeers?: ConnectingPeer[];
    /**
     * Placement variant. 'panel' (default) is the desktop side panel;
     * 'fullscreen' covers the whole viewport, for narrow phone windows.
     */
    layout?: 'panel' | 'fullscreen';
  }>();
  const emits = defineEmits<{
    (event: 'close'): void;
  }>();

  const { t } = useI18n();

  const appStore = useAppStore();

  const activePeerVideos = computed(() => props.peerVideos.filter(item => item.vaStream));
  const notActivePeerVideos = computed(() => props.peerVideos.filter(item => !item.vaStream));

  function statusTextFor(peerAddr: string): string | undefined {
    return props.connectingPeers?.find(p => p.peerAddr === peerAddr)?.statusText;
  }
</script>

<template>
  <div :class="[$style.callParticipants, layout === 'fullscreen' && $style.callParticipantsFullscreen]">
    <div :class="$style.header">
      <div :class="$style.title">
        <ui3n-icon icon="sharp-people" />
        {{ t('va.text.participants') }}
      </div>

      <ui3n-button
        type="icon"
        size="small"
        color="var(--color-bg-control-secondary-default)"
        icon="round-close"
        icon-color="var(--color-icon-button-tritery-default)"
        icon-size="16"
        @click.stop.prevent="() => emits('close')"
      />
    </div>

    <div :class="$style.body">
      <div :class="$style.block">
        <div :class="$style.participant">
          <div :class="$style.participantBlock">
            <chat-avatar
              :name="appStore.user"
              size="24"
            />

            <span :class="[$style.name, $style.active]">
              {{ appStore.user }}
            </span>
          </div>

          <div :class="$style.flag">
            <ui3n-chip
              height="14"
              color="var(--info-fill-default)"
              text-color="var(--info-content-default)"
            >
              {{ t('app.text.msg_sender.you') }}
            </ui3n-chip>
          </div>
        </div>

        <div
          v-for="item in activePeerVideos"
          :key="item.peerAddr"
          :class="$style.participant"
        >
          <div :class="$style.participantBlock">
            <chat-avatar
              :name="item.peerName"
              size="24"
            />

            <span :class="[$style.name, $style.active]">
              {{ item.peerName }}
            </span>
          </div>

          <div :class="$style.flag">
            <div :class="$style.activeFlag" />
          </div>
        </div>
      </div>

      <div :class="$style.block">
        <div
          v-for="item in notActivePeerVideos"
          :key="item.peerAddr"
          :class="$style.participant"
        >
          <div :class="$style.participantBlock">
            <chat-avatar
              :name="item.peerName"
              size="24"
            />

            <div :class="$style.notActiveInfo">
              <span :class="[$style.name, $style.notActive]">
                {{ item.peerName }}
              </span>
              <span
                v-if="statusTextFor(item.peerAddr)"
                :class="$style.statusText"
              >
                {{ statusTextFor(item.peerAddr) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@main/common/assets/styles/mixins' as mixins;

  .callParticipants {
    --call-participants-block-width: 240px;
    --call-participants-header: 40px;
    --call-participants-item-height: 40px;

    position: fixed;
    top: var(--spacing-m);
    right: var(--spacing-m);
    bottom: 64px;
    width: var(--call-participants-block-width);
    border-radius: var(--spacing-m);
    background-color: var(--color-bg-control-secondary-default);
    box-shadow: 0 0 2px 2px var(--shadow-key-1);

    // Phone windows are too narrow for a side panel: cover the whole viewport,
    // above the connecting banner (z-index 2) and the 1-1 own-video PiP tile.
    &.callParticipantsFullscreen {
      inset: 0;
      width: auto;
      border-radius: 0;
      box-shadow: none;
      z-index: 3;

      .header {
        border-top-left-radius: 0;
        border-top-right-radius: 0;
      }
    }
  }

  .header {
    display: flex;
    width: 100%;
    height: var(--call-participants-header);
    border-top-left-radius: var(--spacing-m);
    border-top-right-radius: var(--spacing-m);
    border-bottom: 1px solid var(--color-border-block-primary-pressed);
    justify-content: space-between;
    align-items: center;
    padding-left: var(--spacing-m);
    padding-right: var(--spacing-xs);
  }

  .title {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-xs);
    font-size: var(--font-12);
    font-weight: 600;
    color: var(--color-text-block-primary-default);
  }

  .body {
    position: relative;
    width: 100%;
    height: calc(100% - var(--call-participants-header));
    overflow-y: auto;

    .block:first-child {
      margin-bottom: var(--spacing-m);
    }
  }

  .block {
    position: relative;
    width: 100%;
  }

  .participant {
    display: flex;
    width: 100%;
    height: var(--call-participants-item-height);
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-s);
    padding-left: calc(var(--spacing-s) * 1.5);
    padding-right: var(--spacing-s);
  }

  .block:nth-child(2) .participant {
    height: auto;
    min-height: var(--call-participants-item-height);
    padding-top: var(--spacing-xs);
    padding-bottom: var(--spacing-xs);
  }

  .participantBlock {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    flex-grow: 1;
  }

  .name {
    font-size: var(--font-12);
    font-weight: 500;
    @include mixins.text-overflow-ellipsis();
  }

  .active {
    color: var(--color-text-control-primary-default);
  }

  .notActive {
    color: var(--color-text-control-primary-disabled);
  }

  .notActiveInfo {
    display: flex;
    flex-direction: column;
    row-gap: 2px;
    overflow: hidden;
    flex-grow: 1;
  }

  .statusText {
    font-size: var(--font-10);
    color: var(--color-text-control-primary-disabled);
    @include mixins.text-overflow-ellipsis();
  }

  .flag {
    position: relative;
    min-width: 36px;
    display: flex;
    justify-content: flex-end;
  }

  .activeFlag {
    position: relative;
    width: var(--spacing-s);
    height: var(--spacing-s);
    border-radius: 50%;
    background-color: var(--success-fill-default);

    &::after {
      position: absolute;
      content: '';
      width: var(--spacing-xs);
      height: var(--spacing-xs);
      border-radius: 50%;
      top: 2px;
      left: 2px;
      background-color: var(--success-content-default);
    }
  }
</style>
