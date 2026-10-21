/*
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
*/

/**
 * Video/Audio Setup Composable — infrastructure for device management.
 *
 * This composable handles:
 * - Camera/microphone device enumeration and selection
 * - Own media stream setup (getUserMedia)
 * - Mic/cam toggle controls
 *
 * Note: Call start logic (startChatCall) is implemented for Star architecture
 * with Host/Client role detection and connection handling.
 */

import { computed, inject, onBeforeMount, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { NOTIFICATIONS_KEY, NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import type { DeviceOption } from '@video/common/types';
import { useAppStore } from '@video/common/store/app.store';
import { useStreamsStore } from '@video/common/store/streams.store';
import { registerRoleSwitchHandler } from '@video/common/services/video-chat-service/video-chat-srv';
import { makeLogger } from '@shared/logger';

const log = makeLogger('VASetup');

export function useVaSetup() {
  const { t } = useI18n();
  const router = useRouter();
  const notification = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const appStore = useAppStore();
  const { user } = storeToRefs(appStore);

  const streams = useStreamsStore();
  const { ownVA, isMicOn, isCamOn, pendingDirection, pendingHostAddr, dynamicMediaConstraints } =
    storeToRefs(streams);
  const { setOwnVAStream, setMicOn, setCamOn } = streams;

  /** Whether this is an incoming call (client role) */
  const isIncomingCall = computed(() => pendingDirection.value === 'incoming');

  const choicesWithVideoInput = ref<DeviceOption[]>([]);
  const webcamMenuChoices = computed(() =>
    choicesWithVideoInput.value.filter(({ videoDevLabel }) => videoDevLabel !== ownVA.value?.deviceId),
  );
  const haveVideo = computed(() => choicesWithVideoInput.value.length > 0);
  const haveCamerasToChoose = computed(() => choicesWithVideoInput.value.length > 1);

  const ownVideo = useTemplateRef<HTMLVideoElement>('own-video');

  async function cancel() {
    w3n.closeSelf();
  }

  function attachOwnPreview(): void {
    const el = ownVideo.value;
    if (!el || !ownVA.value) {
      return;
    }
    // The preview must never play own audio, and muted playback is exempt
    // from autoplay blocking (e.g. Android WebView). The muted DOM property
    // is set here as the template attribute alone is easy to lose on rerender.
    el.muted = true;
    el.srcObject = ownVA.value.stream;
    el.play().catch(err => {
      if ((err as DOMException)?.name !== 'AbortError') {
        log.error('Own camera preview playback failed', err);
      }
    });
  }

  function notifyMediaAccessFailure(err: unknown): void {
    log.error('Failed to access camera/microphone', err);
    notification.$createNotice({
      type: 'error',
      content: t('va.setup.notification.media_access_failed'),
    });
  }

  async function setupDeviceChoices(onMount = true): Promise<void> {
    if (onMount) {
      await updateVideoDeviceChoices();

      if (ownVA.value) {
        attachOwnPreview();
      } else if (haveVideo.value) {
        await changeVideoDeviceTo(choicesWithVideoInput.value[0]);
        setCamOn(true);
      } else {
        await setAudioOnlyDevice();
        setCamOn(false);
      }

      setMicOn(true);
      return;
    }

    await updateVideoDeviceChoices();
    if (choicesWithVideoInput.value.find(d => d.videoDevLabel === ownVA.value?.deviceId)) {
      return;
    }

    if (haveVideo.value) {
      await changeVideoDeviceTo(choicesWithVideoInput.value[0]);
      setCamOn(true);
    } else {
      await setAudioOnlyDevice();
      setCamOn(false);
    }

    setMicOn(true);
  }

  async function updateVideoDeviceChoices(): Promise<void> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    choicesWithVideoInput.value = devices
      .filter(({ kind }) => kind === 'videoinput')
      .map(({ deviceId, label: videoDevLabel }) => ({
        videoDevLabel,
        opt: { audio: true, video: { deviceId } },
      }));
  }

  async function changeVideoDeviceTo({ videoDevLabel, opt }: DeviceOption): Promise<void> {
    // Merge device-specific options with dynamic quality constraints
    const constraints: MediaStreamConstraints = {
      audio: typeof opt.audio === 'object' ? { ...opt.audio } : opt.audio,
      video: {
        ...(typeof opt.video === 'object' ? opt.video : {}),
        ...dynamicMediaConstraints.value.video,
      },
    };
    const ownStream = await navigator.mediaDevices.getUserMedia(constraints);
    setOwnVAStream(ownStream, videoDevLabel);
    attachOwnPreview();
  }

  async function setAudioOnlyDevice(): Promise<void> {
    const ownStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    setOwnVAStream(ownStream, null);
  }

  /** Template-facing variant: surfaces getUserMedia failures to the user. */
  async function selectVideoDevice(dev: DeviceOption): Promise<void> {
    try {
      await changeVideoDeviceTo(dev);
    } catch (err) {
      notifyMediaAccessFailure(err);
    }
  }

  function toggleMicStatus() {
    setMicOn(!isMicOn.value);
  }

  function toggleCamStatus() {
    if (!isCamOn.value && !haveVideo.value) {
      notification.$createNotice({
        type: 'error',
        content: t('va.setup.notification.no_cameras'),
      });
    } else {
      setCamOn(!isCamOn.value);
    }
  }

  /**
   * Start or join call.
   * - For outgoing calls (Host): initializes as host and navigates to call view.
   * - For incoming calls (Client): initializes as client with host address and navigates.
   * WebRTC channel initialization happens in use-in-calls.ts via watcher on starConfig.
   */
  async function startChatCall() {
    console.log('[useVaSetup] startChatCall() called', {
      isIncoming: isIncomingCall.value,
      pendingHostAddr: pendingHostAddr.value,
      ownVA: !!ownVA.value,
    });

    try {
      if (isIncomingCall.value && pendingHostAddr.value) {
        // Incoming call: initialize as CLIENT
        console.log(`[useVaSetup] Initializing as CLIENT (host: ${pendingHostAddr.value})`);
        streams.startCall('incoming', pendingHostAddr.value);
        console.log(`[useVaSetup] CLIENT initialized, navigating to call view`);
      } else {
        // Outgoing call: initialize as HOST
        console.log('[useVaSetup] Initializing as HOST');
        streams.startCall('outgoing');
        console.log('[useVaSetup] HOST initialized, navigating to call view');
      }
      // Clear pending state
      streams.pendingDirection = null;
      streams.pendingHostAddr = null;
      console.log('[useVaSetup] Navigating to call view...');
      await router.push({ name: 'call' });
      console.log('[useVaSetup] Navigation complete');
    } catch (err) {
      console.error('[useVaSetup] startChatCall() error:', err);
      notification.$createNotice({
        type: 'error',
        content: t('va.text.call_start_failed'),
      });
    }
  }

  onBeforeMount(async () => {
    try {
      navigator.mediaDevices.ondevicechange = () => {
        setupDeviceChoices(false).catch(notifyMediaAccessFailure);
      };
    } catch (e) {
      console.error('ON_BEFORE_MOUNT ERROR: ', e);
      throw e;
    }
  });

  /**
   * The other person started a call in this chat at the same moment, and theirs
   * is the one that stays. Nothing has been sent from here yet, so all there is
   * to do is to turn "Start" into "Join" - the devices the user picked stay.
   */
  function switchToClientOf({ hostAddr }: { hostAddr: string }): void {
    streams.pendingDirection = 'incoming';
    streams.pendingHostAddr = hostAddr;
    const name = streams.expectedPeers.find(p => p.addr === hostAddr)?.name || hostAddr;
    notification.$createNotice({
      type: 'info',
      content: t('va.text.call_collision_joining', { user: name }),
      duration: 7000,
    });
  }

  const unregisterRoleSwitchHandler = registerRoleSwitchHandler(switchToClientOf);

  onMounted(async () => {
    try {
      await setupDeviceChoices();
    } catch (err) {
      notifyMediaAccessFailure(err);
    }
  });

  onBeforeUnmount(() => {
    unregisterRoleSwitchHandler();
  });

  return {
    t,
    user,
    choicesWithVideoInput,
    webcamMenuChoices,
    haveVideo,
    haveCamerasToChoose,
    ownVideo,
    isCamOn,
    isMicOn,
    ownVA,
    isIncomingCall,
    startChatCall,
    cancel,
    changeVideoDeviceTo: selectVideoDevice,
    toggleMicStatus,
    toggleCamStatus,
  };
}
