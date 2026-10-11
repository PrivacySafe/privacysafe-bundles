/*
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
*/

import { computed, onBeforeMount, onBeforeUnmount, ref } from 'vue';
import { type Deferred, defer } from '@v1nt1248/3nclient-lib/utils';
import type { ScreenShareOption, SharedStream, WindowShareOption } from '@video/common/types';
import type { ScreenShareChoicesProps } from './screen-share-choice-dialog.vue';
import { makeLogger } from '@shared/logger';

const log = makeLogger('ScreenShareDialog');

type DisplaySourceInfo = web3n.media.DisplaySourceInfo;

export function useScreenShareChoiceDialog(props: ScreenShareChoicesProps) {
  const isAudioCaptureAvailable = ref(false);
  const selectAudio = ref(props.initialDeskSoundShared);
  const screenChoices = ref<ScreenShareOption[]>();
  const windowChoices = ref<WindowShareOption[]>();
  const deferredStreams = new Map<string, Deferred<MediaStream>>();

  // Single-select: at most one source in selected[].
  const initialSingle = props.initiallyShared[0];
  const data = ref<{
    selected: SharedStream[];
    selectedDeskSound: boolean;
  }>({
    selected: initialSingle ? [initialSingle] : [],
    selectedDeskSound: props.initialDeskSoundShared,
  });

  const activeSrcId = computed(() => data.value.selected[0]?.srcId ?? null);

  let mediaIdToGet: string | undefined = undefined;

  function isAlreadyShared(srcId: string): boolean {
    return !!props.initiallyShared.find(s => s.srcId === srcId);
  }

  function makeDeferredStream(srcId: string): Promise<MediaStream> {
    const deferredStream = defer<MediaStream>();
    deferredStreams.set(srcId, deferredStream);
    return deferredStream.promise;
  }

  async function collectAvailableScreenShareOptions(): Promise<void> {
    await w3n.mediaDevices!.setSelectDisplayMediaForCaptureHandler!(displayChoicesCollectionCB);

    mediaIdToGet = undefined;
    const stream = await navigator.mediaDevices
      .getDisplayMedia({ video: true, audio: true })
      .catch(err => {
        log.warn('getDisplayMedia for collecting sources failed (expected on 3N platform). ', err);
        return undefined;
      });

    // Immediately stop the initial getDisplayMedia stream — it's only used to
    // trigger displayChoicesCollectionCB and populate screenChoices/windowChoices.
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    // Resolve deferred streams only for initiallySelected items (already shared).
    // For unselected items, capture happens in onOptionSelectionChange when the
    // user actually toggles the switch.
    function resolveInitial(opt: ScreenShareOption | WindowShareOption): void {
      if (opt.initiallySelected) {
        const shared = props.initiallyShared.find(s => s.srcId === opt.srcId);
        if (shared) {
          deferredStreams.get(opt.srcId)?.resolve(shared.stream);
        }
      }
    }

    if (screenChoices.value) {
      for (const screen of screenChoices.value) {
        resolveInitial(screen);
      }
    }

    if (windowChoices.value) {
      for (const frame of windowChoices.value) {
        resolveInitial(frame);
      }
    }
  }

  async function displayChoicesCollectionCB(choices: DisplaySourceInfo): Promise<string | undefined> {
    if (mediaIdToGet === undefined) {
      screenChoices.value = choices.screens?.map(info => {
        const { id: srcId, name, display_id } = info;
        const thumbnailURL = toImgURL(info.thumbnail)!;
        return {
          srcId,
          name,
          display_id,
          thumbnailURL,
          initiallySelected: isAlreadyShared(srcId),
          stream: makeDeferredStream(srcId),
        };
      });
      windowChoices.value = choices.windows?.map(info => {
        const { id: srcId, name } = info;
        const thumbnailURL = toImgURL(info.thumbnail)!;
        const appIconURL = toImgURL(info.appIcon);
        return {
          srcId,
          name,
          thumbnailURL,
          appIconURL,
          initiallySelected: isAlreadyShared(srcId),
          stream: makeDeferredStream(srcId),
        };
      });

      return;
    }

    return mediaIdToGet;
  }

  function toImgURL(arr: Uint8Array | undefined): string | undefined {
    if (!arr) {
      return;
    }

    const blob = new Blob([arr as BlobPart], { type: 'image/bmp' });
    return URL.createObjectURL(blob);
  }

  function onDeskSoundChange(v: boolean): void {
    data.value.selectedDeskSound = v;
  }

  /**
   * Drop every selected source except optional keepSrcId.
   * Stops capture tracks for sources that were not initially shared
   * (live call streams stay intact until confirm/removeOwnScreen).
   */
  async function clearSelectedExcept(keepSrcId?: string): Promise<void> {
    const kept: SharedStream[] = [];
    for (const item of data.value.selected) {
      if (keepSrcId && item.srcId === keepSrcId) {
        kept.push(item);
        continue;
      }
      if (!isAlreadyShared(item.srcId)) {
        try {
          item.stream.getTracks().forEach(track => track.stop());
        } catch {
          // ignore stop errors on already-ended tracks
        }
      }
    }
    data.value.selected = kept;
  }

  async function captureStreamForOption(
    opt: ScreenShareOption | WindowShareOption,
  ): Promise<MediaStream | undefined> {
    const deferred = deferredStreams.get(opt.srcId);
    if (deferred) {
      mediaIdToGet = opt.srcId;
      const captured = await navigator.mediaDevices
        .getDisplayMedia({ video: true })
        .catch(err => {
          log.error(`Failed to capture stream for ${opt.srcId}`, err);
          return undefined;
        });
      mediaIdToGet = undefined;
      if (captured) {
        deferredStreams.delete(opt.srcId);
        deferred.resolve(captured);
        return captured;
      }
      return undefined;
    }

    const existing = await opt.stream.catch(() => undefined);
    if (!existing) {
      return undefined;
    }
    const live = existing.getVideoTracks().some(t => t.readyState === 'live');
    if (live || isAlreadyShared(opt.srcId)) {
      return existing;
    }

    // Previous capture ended (e.g. user switched away) — recapture.
    mediaIdToGet = opt.srcId;
    const recaptured = await navigator.mediaDevices
      .getDisplayMedia({ video: true })
      .catch(err => {
        log.error(`Failed to recapture stream for ${opt.srcId}`, err);
        return undefined;
      });
    mediaIdToGet = undefined;
    if (recaptured) {
      (opt as { stream: Promise<MediaStream> }).stream = Promise.resolve(recaptured);
      return recaptured;
    }
    return undefined;
  }

  async function onOptionSelectionChange(
    opt: ScreenShareOption | WindowShareOption,
    v: boolean,
  ): Promise<void> {
    if (v) {
      // Capture first so a failed pick does not clear the previous selection.
      const stream = await captureStreamForOption(opt);
      if (!stream) {
        return;
      }

      // Exclusive single-select: drop any other source (replace).
      await clearSelectedExcept(opt.srcId);

      if (!data.value.selected.some(s => s.srcId === opt.srcId)) {
        data.value.selected = [
          {
            srcId: opt.srcId,
            stream,
            type: (opt as ScreenShareOption).display_id ? 'screen' : 'window',
            name: opt.name,
          },
        ];
      }
    } else {
      if (data.value.selected.some(s => s.srcId === opt.srcId)) {
        await clearSelectedExcept(); // clear all including this one
      }
    }
  }

  onBeforeMount(async () => {
    isAudioCaptureAvailable.value = !!(await w3n.mediaDevices?.isAudioCaptureAvailable());

    collectAvailableScreenShareOptions();
  });

  onBeforeUnmount(() => {
    w3n.mediaDevices!.setSelectDisplayMediaForCaptureHandler!(async () => undefined);
  });

  return {
    data,
    activeSrcId,
    isAudioCaptureAvailable,
    selectAudio,
    screenChoices,
    windowChoices,
    onOptionSelectionChange,
    onDeskSoundChange,
  };
}
