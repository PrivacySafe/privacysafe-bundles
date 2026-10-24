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
<script lang="ts" setup>
  import { computed, onBeforeUnmount, onMounted } from 'vue';
  import size from 'lodash/size';
  import { useInCalls } from '@video/common/composables/use-in-calls';
  import { Ui3nButton } from '@v1nt1248/3nclient-lib';
  import OwnVideo from '@video/common/components/own-video.vue';
  import PeerVideo from '@video/common/components/peer-video.vue';
  import CallParticipants from '@video/common/components/call-participants.vue';

  const {
    t,
    ownName,
    isGroupChat,
    isParticipantListOpen,
    peerVideos,
    activePeerVideos,
    connectingPeers,
    activeConnectingPeers,
    waitingPeersCount,
    streams,
    doOnMounted,
    doBeforeUnmount,
    toggleMicStatus,
    toggleCamStatus,
    endCall,
  } = useInCalls();

  const peersNumber = computed(() => size(activePeerVideos.value) + 1);

  const participantColumnsNumber = computed(() => {
    if (peersNumber.value <= 3) {
      return 1;
    }

    return 2;
  });
  const participantRowsNumber = computed(() => Math.ceil(peersNumber.value / participantColumnsNumber.value));

  const gapInUiBetweenParticipants = 8;

  const mainStyle = computed(() => ({
    '--gap-in-ui-between-participants': `${gapInUiBetweenParticipants}px`,
    '--participant-block-width': `calc((100% - ${participantColumnsNumber.value - 1} * ${gapInUiBetweenParticipants}px) / ${participantColumnsNumber.value})`,
    '--participant-block-height': `calc((100% - ${participantRowsNumber.value - 1} * ${gapInUiBetweenParticipants}px) / ${participantRowsNumber.value})`,
  }));

  onMounted(doOnMounted);
  onBeforeUnmount(doBeforeUnmount);
</script>

<template>
  <div
    :class="[$style.call, !isGroupChat && $style.callOneToOne]"
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

    <div :class="[$style.participant, $style.participantOwn]">
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
      :class="[$style.participant, $style.participantOther]"
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

    <div :class="$style.actions">
      <div :class="$style.actionGroup">
        <ui3n-button
          v-if="isGroupChat"
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="sharp-people"
          icon-color="var(--color-icon-button-tritery-default)"
          @click.stop.prevent="isParticipantListOpen = !isParticipantListOpen"
        />

        <div
          v-else
          :class="$style.empty"
        />
      </div>

      <div :class="$style.actionGroup">
        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          :icon="streams.isMicOn ? 'round-mic-none' : 'round-mic-off'"
          icon-color="var(--color-icon-button-tritery-default)"
          @click.stop.prevent="toggleMicStatus"
        />

        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          :icon="streams.isCamOn ? 'outline-videocam' : 'outline-videocam-off'"
          icon-color="var(--color-icon-button-tritery-default)"
          @click.stop.prevent="toggleCamStatus"
        />
      </div>

      <div :class="$style.actionGroup">
        <ui3n-button
          type="icon"
          color="var(--error-content-default)"
          icon="round-phone-disabled"
          icon-color="var(--error-fill-default)"
          icon-position="left"
          @click.stop.prevent="() => endCall()"
        />
      </div>
    </div>

    <call-participants
      v-if="isParticipantListOpen"
      layout="fullscreen"
      :peer-videos="peerVideos"
      :connecting-peers="connectingPeers"
      @close="isParticipantListOpen = false"
    />
  </div>
</template>

<style lang="scss" module>
  .call {
    --call-actions-height: 64px;

    position: fixed;
    inset: 0;
    padding-bottom: var(--call-actions-height);
    background-color: var(--color-bg-control-secondary-default);
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: var(--gap-in-ui-between-participants);

    &.callOneToOne {
      padding-bottom: 0;

      .participantOther {
        display: flex;
        width: 100%;
        height: 100%;
        justify-content: center;
        align-items: stretch;

        video {
          display: block;
          object-fit: cover;
          object-position: center;
          width: 100%;
        }
      }

      .participantOwn {
        position: absolute;
        width: 120px;
        height: 180px;
        right: var(--spacing-s);
        bottom: 96px;
        overflow: hidden;
        display: flex;
        justify-content: center;
        align-items: stretch;
        z-index: 1;
        background-color: var(--color-bg-control-secondary-default);
        border: 1px solid var(--color-border-control-secondary-disabled);
        border-radius: var(--spacing-s);

        video {
          display: block;
          object-fit: cover;
          object-position: center;
          width: 100%;
        }
      }

      .actions {
        bottom: var(--spacing-m);
        background-color: transparent;
        justify-content: center;
        column-gap: var(--spacing-ml);

        .actionGroup {
          column-gap: var(--spacing-ml);
        }
      }

      .empty {
        display: none;
      }
    }
  }

  .participant {
    position: relative;
    width: var(--participant-block-width);
    height: var(--participant-block-height);
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
    background-color: var(--color-bg-block-primary-default);
  }

  .actionGroup {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .empty {
    position: relative;
    width: var(--spacing-l);
    min-width: var(--spacing-l);
    height: var(--spacing-l);
    min-height: var(--spacing-l);
  }

  .connectingBanner {
    position: absolute;
    left: 50%;
    top: var(--spacing-s);
    transform: translateX(-50%);
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    row-gap: var(--spacing-xs);
    max-width: 90%;
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
