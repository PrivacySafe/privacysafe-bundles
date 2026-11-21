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
  import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
  import size from 'lodash/size';
  import { Ui3nButton } from '@v1nt1248/3nclient-lib';
  import { useInCalls } from '@video/common/composables/use-in-calls';
  import IconButton from '@video/desktop/components/icon-button.vue';
  import OwnVideo from '@video/common/components/own-video.vue';
  import PeerVideo from '@video/common/components/peer-video.vue';
  import CallParticipants from '@video/common/components/call-participants.vue';
  import ViewSharedThings from '@video/desktop/components/view-shared-things.vue';

  const {
    t,
    ownName,
    isFullscreen,
    screenShareMode,
    isParticipantListOpen,
    ownScreens,
    peerSharedStreams,
    peerVideos,
    activePeerVideos,
    connectingPeers,
    activeConnectingPeers,
    waitingPeersCount,
    streams,
    canShareScreen,
    openScreenShareChoice,
    toggleCamStatus,
    toggleMicStatus,
    toggleFullscreen,
    toggleScreenShareMode,
    endCall,
    removeOwnScreen,
    doBeforeUnmount,
    doOnMounted,
  } = useInCalls();

  const participantListWidth = ref(192);
  const participantListWidthRange = [80, 600];
  const participantListHeight = ref(148);
  const participantListHeightRange = [64, 440];

  const bodyEl = useTemplateRef<HTMLDivElement>('screenShareBody');
  const resizerEl = useTemplateRef<HTMLDivElement>('resizer');
  const shift = ref(0);

  const activePeersNumber = computed(() => size(activePeerVideos.value) + 1);
  const peersShare = computed(() => peerSharedStreams.value.length > 0);
  const sharingOwnScreen = computed(() => (ownScreens.value?.length ?? 0) > 0);
  const screenShare = computed(() => peersShare.value || sharingOwnScreen.value);
  const sharedThings = computed(() => [...(ownScreens.value || []), ...peerSharedStreams.value]);

  const gapInUiBetweenParticipants = 16;

  const participantColumnsNumber = computed(() => {
    if (activePeersNumber.value <= 4) {
      return 2;
    }

    if (activePeersNumber.value <= 6) {
      return 3;
    }

    return 4;
  });

  const participantRowsNumber = computed(() =>
    Math.ceil(activePeersNumber.value / participantColumnsNumber.value),
  );

  const mainStyle = computed(() => ({
    '--gap-in-ui-between-participants': `${gapInUiBetweenParticipants}px`,
    '--participant-block-width': `calc((100% - ${participantColumnsNumber.value - 1} * ${gapInUiBetweenParticipants}px) / ${participantColumnsNumber.value})`,
    '--participant-block-height': `calc((100% - ${participantRowsNumber.value - 1} * ${gapInUiBetweenParticipants}px) / ${participantRowsNumber.value})`,
    '--participant-list-width': `${participantListWidth.value}px`,
    '--participant-list-height': `${participantListHeight.value}px`,
  }));

  function onDragstart() {
    return false;
  }

  function onPointerMove(event: PointerEvent) {
    const bodyElClientRect = bodyEl.value!.getBoundingClientRect();
    if (screenShareMode.value === 'row') {
      let newParticipantListWidth = Math.round(bodyElClientRect.right - (event.clientX - shift.value) + 2);
      if (newParticipantListWidth < participantListWidthRange[0]) {
        newParticipantListWidth = participantListWidthRange[0];
      } else if (newParticipantListWidth > participantListWidthRange[1]) {
        newParticipantListWidth = participantListWidthRange[1];
      }

      participantListWidth.value = newParticipantListWidth;
    } else {
      let newParticipantListHeight = Math.round(event.clientY - shift.value + 2 - bodyElClientRect.top);
      if (newParticipantListHeight < participantListHeightRange[0]) {
        newParticipantListHeight = participantListHeightRange[0];
      } else if (newParticipantListHeight > participantListHeightRange[1]) {
        newParticipantListHeight = participantListHeightRange[1];
      }

      participantListHeight.value = newParticipantListHeight;
    }
  }

  function onPointerDown(event: PointerEvent) {
    event.preventDefault();

    shift.value =
      screenShareMode.value === 'row'
        ? event.clientX - resizerEl.value!.getBoundingClientRect().left
        : event.clientY - resizerEl.value!.getBoundingClientRect().top;

    resizerEl.value!.setPointerCapture(event.pointerId);
    resizerEl.value!.onpointermove = onPointerMove;

    resizerEl.value!.onpointerup = () => {
      resizerEl.value!.onpointermove = null;
      resizerEl.value!.onpointerup = null;
    };
  }

  onMounted(doOnMounted);
  onBeforeUnmount(doBeforeUnmount);
</script>

<template>
  <section
    :class="$style.call"
    :style="mainStyle"
  >
    <div
      v-if="activeConnectingPeers.length > 0 || waitingPeersCount > 0"
      :class="$style.connectingBanner"
    >
      <div
        v-for="peer in activeConnectingPeers"
        :key="peer.peerAddr"
        :class="[$style.connectingBannerItem, peer.status === 'timeout' && $style.connectingBannerItemMuted]"
      >
        {{ peer.statusText }}
      </div>
      <div
        v-if="waitingPeersCount > 0"
        :class="[$style.connectingBannerItem, $style.connectingBannerItemMuted]"
      >
        {{ t('call.text.waiting_for_participants', { count: waitingPeersCount }) }}
      </div>
    </div>

    <template v-if="!screenShare">
      <div :class="$style.participant">
        <own-video
          :is-cam-on="streams.isCamOn"
          :stream="streams.ownVA!.stream"
          :user="ownName"
          :is-host="streams.isHost"
        />
      </div>

      <div
        v-for="peer in activePeerVideos"
        :key="peer.peerAddr"
        :class="$style.participant"
      >
        <peer-video
          :is-video-on="!peer.videoMuted"
          :is-audio-on="!peer.audioMuted"
          :is-reconnecting="peer.isReconnecting"
          :stream="peer.vaStream"
          :peer-name="peer.peerName"
          :peer-addr="peer.peerAddr"
          :is-host="streams.isHostAddr(peer.peerAddr)"
        />
      </div>
    </template>

    <div
      v-if="screenShare"
      ref="screenShareBody"
      :class="[$style.body, screenShareMode === 'column' && $style.bodyColumn]"
    >
      <div :class="$style.sharedScreens">
        <view-shared-things
          :things="sharedThings"
          :remove-own-screen="removeOwnScreen"
        />
      </div>

      <div :class="$style.list">
        <div :class="$style.participants">
          <div :class="$style.participantsItem">
            <own-video
              :is-cam-on="streams.isCamOn"
              :stream="streams.ownVA!.stream"
              :user="ownName"
              :is-host="streams.isHost"
              size="small"
            />
          </div>

          <div
            v-for="peer in activePeerVideos"
            :key="peer.peerAddr"
            :class="$style.participantsItem"
          >
            <peer-video
              :is-video-on="!peer.videoMuted"
              :is-audio-on="!peer.audioMuted"
              :is-reconnecting="peer.isReconnecting"
              :stream="peer.vaStream"
              :peer-name="peer.peerName"
              :peer-addr="peer.peerAddr"
              :is-host="streams.isHostAddr(peer.peerAddr)"
              size="small"
            />
          </div>
        </div>
      </div>

      <div
        ref="resizer"
        :class="$style.resizer"
        @click.stop.prevent
        @dragstart="onDragstart"
        @pointerdown="onPointerDown"
      />
    </div>

    <div :class="$style.actions">
      <div :class="$style.actionGroup">
        <icon-button
          :icon="isFullscreen ? 'shrink' : 'expand-screen'"
          :tooltip="
            isFullscreen ? t('call.tooltip.fullscreen_mode_disable') : t('call.tooltip.fullscreen_mode_enable')
          "
          @click.stop.prevent="toggleFullscreen"
        />

        <icon-button
          v-if="screenShare"
          :icon="screenShareMode === 'row' ? 'splitscreen-top' : 'splitscreen-right'"
          :tooltip="
            screenShareMode === 'row'
              ? t('call.tooltip.screenshare_mode_column')
              : t('call.tooltip.screenshare_mode_row')
          "
          @click.stop.prevent="toggleScreenShareMode"
        />
      </div>

      <div :class="$style.actionGroup">
        <icon-button
          :icon="streams.isMicOn ? 'round-mic-none' : 'round-mic-off'"
          :tooltip="streams.isMicOn ? t('call.tooltip.mic_off') : t('call.tooltip.mic_on')"
          tooltip-placement="top"
          @click.stop.prevent="toggleMicStatus"
        />

        <icon-button
          :icon="streams.isCamOn ? 'outline-videocam' : 'outline-videocam-off'"
          :tooltip="streams.isCamOn ? t('call.tooltip.camera_off') : t('call.tooltip.camera_on')"
          tooltip-placement="top"
          @click.stop.prevent="toggleCamStatus"
        />

        <icon-button
          icon="outline-screen-share"
          :tooltip="t('call.tooltip.sharing_on')"
          tooltip-placement="top"
          :disabled="!canShareScreen"
          @click.stop.prevent="openScreenShareChoice"
        />

        <icon-button
          v-if="streams.isGroupChat"
          icon="sharp-people"
          :tooltip="t('call.tooltip.participants_info')"
          tooltip-placement="top"
          @click.stop.prevent="isParticipantListOpen = !isParticipantListOpen"
        />
      </div>

      <div :class="$style.actionGroup">
        <ui3n-button
          type="custom"
          color="var(--error-content-default)"
          text-color="var(--white-100)"
          icon="round-phone-disabled"
          icon-color="var(--error-fill-default)"
          icon-position="left"
          @click.stop.prevent="() => endCall()"
        >
          {{ t('va.btn.end_call') }}
        </ui3n-button>
      </div>
    </div>

    <call-participants
      v-if="isParticipantListOpen"
      :peer-videos="peerVideos"
      :connecting-peers="connectingPeers"
      @close="isParticipantListOpen = false"
    />
  </section>
</template>

<style lang="scss" module>
  .call {
    --call-actions-height: 64px;

    position: relative;
    width: 100%;
    height: 100%;
    padding: var(--spacing-m) var(--spacing-m) var(--call-actions-height) var(--spacing-m);
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: var(--gap-in-ui-between-participants);
  }

  .participant {
    position: relative;
    width: var(--participant-block-width);
    height: var(--participant-block-height);
  }

  .body {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: space-between;
    align-items: stretch;
    border-bottom: 1px solid var(--color-border-block-primary-default);

    &.bodyColumn {
      flex-direction: column-reverse;

      .sharedScreens {
        width: 100%;
        height: calc(100% - var(--participant-list-height) - var(--spacing-s));
        border-right: none;
        border-top: 1px solid var(--color-border-block-primary-default);
      }

      .list {
        width: 100%;
        height: var(--participant-list-height);
        overflow-x: auto;

        .participants {
          flex-direction: row;
          column-gap: var(--spacing-s);
        }

        .participantsItem {
          width: auto;
          height: calc(var(--participant-list-height) - var(--spacing-m));
        }
      }

      .resizer {
        left: 2px;
        width: calc(100% - 4px);
        top: calc(var(--participant-list-height) - 2px);
        height: 6px;
        cursor: row-resize;
      }
    }
  }

  .sharedScreens {
    position: relative;
    width: calc(100% - var(--participant-list-width) - var(--spacing-s));
    height: 100%;
    border-right: 1px solid var(--color-border-block-primary-default);
    border-top: none;
  }

  .list {
    position: relative;
    width: var(--participant-list-width);
    height: 100%;
    padding: var(--spacing-s) 0 var(--spacing-s) var(--spacing-s);
    overflow-y: auto;
  }

  .resizer {
    position: absolute;
    top: 2px;
    height: calc(100% - 4px);
    right: calc(var(--participant-list-width) - 2px);
    width: 6px;
    border-radius: 3px;
    cursor: col-resize;

    &:hover {
      background-color: var(--color-border-block-primary-default);
    }
  }

  .participants {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
    row-gap: var(--spacing-s);
  }

  .participantsItem {
    position: relative;
    width: 100%;
    height: auto;
    aspect-ratio: 4 / 3;
  }

  .actions {
    position: absolute;
    left: 0;
    width: 100%;
    bottom: 0;
    height: var(--call-actions-height);
    padding: 0 var(--spacing-m);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .actionGroup {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-l);
  }

  .connectingBanner {
    position: absolute;
    left: 50%;
    top: var(--spacing-m);
    transform: translateX(-50%);
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    row-gap: var(--spacing-xs);
    max-width: 80%;
    pointer-events: none;
  }

  .connectingBannerItem {
    padding: var(--spacing-s) var(--spacing-m);
    border-radius: var(--spacing-s);
    background-color: var(--info-fill-default);
    color: var(--info-content-default);
    font-size: 13px;
    font-weight: 500;
    line-height: 1.3;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow:
      0 0 16px 0 var(--shadow-key-1),
      0 0 4px 0 var(--shadow-key-2);
  }

  .connectingBannerItemMuted {
    background-color: var(--warning-fill-default);
    color: var(--warning-content-default);
  }
</style>
