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

import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { ThemeId } from '@v1nt1248/3nclient-lib/plugins';
import { AvailableLanguage } from '~/app.types';
import { useSystemLevelAppConfig } from './app/system-level-app-config';
import { useConnectivityStatus } from './app/connectivity';
import { useMediaRecordingSupport } from './app/media-recording';
import { useSyncState } from './app/sync-state';
import { chatService } from '@main/common/services/external-services';
import {
  callBackend,
  describeStartingStatus,
  isBackendUnreachable,
} from '@main/common/services/backend-availability';
import { type Ui3nResizeCbArg } from '@v1nt1248/3nclient-lib';

export interface AppStoreState {
  commonLoading: boolean;
  isMobileMode: boolean;
  appVersion: string;
  connectivityStatus: string;
  user: string;
  lang: AvailableLanguage;
  colorTheme: ThemeId;
  appWindowSize: {
    width: number;
    height: number;
  };
}

export interface AppWindowSize {
  width: number;
  height: number;
}

/**
 * How the window sees its background component.
 *
 * 'starting' covers both "we have not asked yet" and "it says it is still
 * opening its databases", which are the same thing to a screen that has to
 * keep waiting. The other two are ends: 'unreachable' is a component that
 * answers no ping, 'failed' one that answers and says its start-up threw.
 */
export type BackendState = 'starting' | 'ready' | 'unreachable' | 'failed';

export const useAppStore = defineStore('app', () => {
  const commonLoading = ref(false);
  const isMobileMode = ref<boolean>(false);
  const appDeviceId = ref<string>('');
  const backendState = ref<BackendState>('starting');
  /** What the component says it is doing, for a caption while it starts. */
  const backendStage = ref<string>('');
  const appWindowSize = ref<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const connectivity = useConnectivityStatus();
  const { connectivityStatus } = connectivity;

  const commonAppConfs = useSystemLevelAppConfig();
  const { appVersion, user, lang, colorTheme, customLogoSrc } = commonAppConfs;

  const mediaRecording = useMediaRecordingSupport();
  const { canRecordAudio, canRecordVideo, canRecord, refreshRecordingSupport } = mediaRecording;

  // Deliberately not initialized here: initialize() runs before the GUI
  // subscribes to background events (see useAppView), and asking for the current
  // state before that would leave a gap in which changes go unnoticed. The ask is
  // made right after the subscription instead - see useInitialize.
  const sync = useSyncState();

  function setMobileMode(value: boolean) {
    isMobileMode.value = value;
  }

  function setCommonLoading(value: boolean) {
    commonLoading.value = value;
  }

  function setAppWindowSize(value: Ui3nResizeCbArg) {
    appWindowSize.value = {
      width: value.width,
      height: value.contentHeight,
    };
  }

  async function initialize() {
    // The three local ones first, and separately: they touch no IPC, and
    // nothing about them should share a fate with the call below.
    await Promise.all([
      connectivity.initialize(),
      commonAppConfs.initialize(),
      mediaRecording.initialize(),
    ]);
    // The window's first real call into the background component, and
    // therefore the place where "connected to something that never answers"
    // is found out. Through callBackend, so that it ends in a verdict rather
    // than in a wait with no end (2026-09-10).
    try {
      appDeviceId.value = await callBackend(
        'getAppDeviceId',
        // Declared as returning a string, though over IPC it is a promise -
        // hence the async wrapper rather than a bare reference.
        async () => chatService.getAppDeviceId(),
        {
          onStillStarting: status => {
            backendState.value = 'starting';
            backendStage.value = describeStartingStatus(status);
          },
        },
      );
      backendState.value = 'ready';
      backendStage.value = '';
    } catch (err) {
      backendState.value = isBackendUnreachable(err) ? 'unreachable' : 'failed';
      throw err;
    }
  }

  function stopWatching() {
    connectivity.stopConnectivityCheck();
    commonAppConfs.stopWatching();
    mediaRecording.stopWatching();
  }

  return {
    commonLoading,
    isMobileMode,
    appDeviceId,
    backendState,
    backendStage,
    appVersion,
    appWindowSize,
    user,
    lang,
    colorTheme,
    customLogoSrc,
    connectivityStatus,
    canRecordAudio,
    canRecordVideo,
    canRecord,
    ...sync,
    refreshRecordingSupport,
    setMobileMode,
    setCommonLoading,
    setAppWindowSize,
    initialize,
    stopWatching,
  };
});
