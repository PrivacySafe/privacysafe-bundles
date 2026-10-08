/*
 Copyright (C) 2024 3NSoft Inc.

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
import { inject, ref } from 'vue';
import { VUEBUS_KEY, VueBusPlugin } from '@v1nt1248/3nclient-lib/plugins';
import type { GlobalEvents } from '@/common/types';

export type AppProcessType = 'downloading' | 'unzipping' | 'installing' | 'update-checking';

export type PlatformProcessType = 'platform-update-checking';

export type ProcessType = AppProcessType | PlatformProcessType;

export interface ProcessInfo {
  procType: ProcessType;
  version?: string;
  progressValue?: number;
}

export const PLATFORM_ID = 'platform';

export function makeProcessesPlace() {
  const { $emitter } = inject<VueBusPlugin<GlobalEvents>>(VUEBUS_KEY)!;

  const processes = ref<Record<string, ProcessInfo[]>>({});

  function emitEvent(evToEmit: Partial<GlobalEvents> | undefined): void {
    if (evToEmit) {
      for (const [event, content] of Object.entries(evToEmit)) {
        $emitter.emit(event as never as keyof GlobalEvents, content);
      }
    }
  }

  function delProcess(appId: string | null, procType: ProcessType, evToEmit?: Partial<GlobalEvents>) {
    if (appId === null) {
      appId = PLATFORM_ID;
    }
    const arr = processes.value[appId];
    if (!arr) {
      return;
    }
    const foundInd = arr.findIndex(info => info.procType === procType);
    if (foundInd < 0) {
      return;
    }
    if (arr.length > 1) {
      arr.splice(foundInd, 1);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete processes.value[appId];
    }
    emitEvent(evToEmit);
  }

  function upsertProcess(appId: string | null, processInfo: ProcessInfo, evToEmit?: Partial<GlobalEvents>) {
    if (appId === null) {
      appId = PLATFORM_ID;
    }
    const arr = processes.value[appId];
    if (arr) {
      const ind = arr.findIndex(({ procType }) => processInfo.procType === procType);
      if (ind < 0) {
        arr.push(processInfo);
      } else {
        arr[ind] = processInfo;
      }
    } else {
      processes.value[appId] = [processInfo];
    }
    emitEvent(evToEmit);
  }

  return {
    processes,

    delProcess,
    upsertProcess,
    emitEvent,
  };
}

export type ProcessesPlace = ReturnType<typeof makeProcessesPlace>;
