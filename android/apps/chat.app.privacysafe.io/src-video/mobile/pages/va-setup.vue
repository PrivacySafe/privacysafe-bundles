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
  import { Ui3nButton, Ui3nIcon, Ui3nMenu } from '@v1nt1248/3nclient-lib';
  import { useVaSetup } from '@video/common/composables/use-va-setup';
  import VideoPlaceholder from '@video/common/components/video-placeholder.vue';

  const {
    t,
    user,
    haveCamerasToChoose,
    webcamMenuChoices,
    haveVideo,
    isMicOn,
    isCamOn,
    ownVA,
    isIncomingCall,
    cancel,
    startChatCall,
    toggleMicStatus,
    toggleCamStatus,
    changeVideoDeviceTo,
  } = useVaSetup();
</script>

<template>
  <div :class="$style.vaSetup">
    <div :class="$style.header">
      <ui3n-button @click.stop.prevent="startChatCall">
        {{ isIncomingCall ? t('va.presettings.btn.join') : t('va.presettings.btn.start') }}
      </ui3n-button>

      <span>{{ t('va.setup.title') }}</span>

      <ui3n-button
        type="custom"
        color="var(--error-content-default)"
        text-color="var(--white-100)"
        @click.stop.prevent="cancel"
      >
        {{ t('dialog.button.default.cancel') }}
      </ui3n-button>
    </div>

    <div :class="$style.content">
      <div :class="$style.body">
        <video
          v-show="haveVideo && isCamOn"
          ref="own-video"
          :class="$style.video"
          playsinline
          autoplay
          muted
        />

        <video-placeholder
          v-show="!haveVideo || !isCamOn"
          :user-name="user"
        />
      </div>

      <div :class="$style.settings">
        <ui3n-button
          type="custom"
          color="var(--color-bg-button-tritery-default)"
          :icon="isMicOn ? 'round-mic-none' : 'round-mic-off'"
          icon-color="var(--color-icon-button-tritery-default)"
          :class="$style.settingsBtn"
          @click.stop.prevent="toggleMicStatus"
        />

        <ui3n-button
          type="custom"
          color="var(--color-bg-button-tritery-default)"
          :icon="isCamOn ? 'outline-videocam' : 'outline-videocam-off'"
          icon-color="var(--color-icon-button-tritery-default)"
          :class="$style.settingsBtn"
          @click.stop.prevent="toggleCamStatus"
        />

        <ui3n-menu
          v-show="haveCamerasToChoose"
          :offset-y="4"
        >
          <div :class="$style.currentWebcam">
            {{ ownVA?.deviceId }}

            <ui3n-icon
              icon="outline-arrow-drop-down"
              size="24"
            />
          </div>

          <template #menu>
            <div
              v-for="dev in webcamMenuChoices"
              :key="dev.videoDevLabel"
              :class="$style.webcamChoice"
              @click="changeVideoDeviceTo(dev)"
            >
              {{ dev.videoDevLabel }}
            </div>
          </template>
        </ui3n-menu>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
  .vaSetup {
    --va-setup-header-height: 48px;
    --va-setup-settings-height: 48px;

    position: fixed;
    inset: 0;
    background-color: var(--color-bg-block-primary-default);
  }

  .header {
    display: flex;
    width: 100%;
    height: var(--va-setup-header-height);
    justify-content: space-between;
    align-items: center;
    padding: 0 var(--spacing-m);
    border-bottom: 1px solid var(--color-border-block-primary-default);
  }

  .content {
    position: relative;
    width: 100%;
    height: calc(100% - var(--va-setup-header-height) - var(--spacing-s));
  }

  .body {
    position: relative;
    width: 100%;
    height: calc(100% - var(--va-setup-settings-height));
    background-color: var(--color-bg-control-secondary-default);
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .video {
    position: relative;
    width: calc(100% - var(--spacing-xs));
    height: calc(100% - var(--spacing-xs));
    border-radius: var(--spacing-s);
    transform: rotateY(180deg);
    background-color: var(--color-bg-control-secondary-default);
  }

  .settings {
    display: flex;
    width: 100%;
    height: var(--va-setup-settings-height);
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-m);
  }

  .settingsBtn {
    padding: 0 var(--spacing-s) !important;
    column-gap: 0 !important;
  }

  .currentWebcam {
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-xs);
    color: var(--color-icon-button-tritery-default);
    background-color: var(--color-bg-button-tritery-default);
    padding: var(--spacing-s);
    cursor: pointer;
  }

  .webcamChoice {
    color: var(--color-icon-button-tritery-default);
    background-color: var(--color-bg-button-tritery-default);
    padding: var(--spacing-s);
    cursor: pointer;

    &:hover {
      background-color: var(--color-bg-control-primary-hover);
    }
  }
</style>
