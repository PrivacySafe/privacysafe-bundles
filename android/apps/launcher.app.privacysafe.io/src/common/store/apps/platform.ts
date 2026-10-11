/*
 Copyright (C) 2024 - 2025 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

 This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { ChannelVersion } from '@/common/types';
import { debouncedFnCall } from '@/common/utils/debounce';
import { ref } from 'vue';
import { ProcessesPlace } from './processes';
import { sleep } from '@v1nt1248/3nclient-lib/utils';
import { RestartInfo } from './restart-info';

type ProgressInfo = web3n.system.platform.ProgressInfo;

export interface PlatformInfo {
  version: string;
  availableUpdates?: ChannelVersion[];
  // XXX process info can be moved to process store
  updateInProcess?: {
    version: string;
    progress?: ProgressInfo;
  };
}

export function makePlatform(
  delProcess: ProcessesPlace['delProcess'],
  upsertProcess: ProcessesPlace['upsertProcess'],
  restart: RestartInfo['restart'],
  setPlatformRestart: RestartInfo['setPlatformRestart'],
) {
  const platform = ref<PlatformInfo>({
    version: '',
  });

  const downloadPlatformUpdate = debouncedFnCall(async () => {
    const downloader = w3n.system?.platform?.downloader;
    if (!downloader || !platform.value.availableUpdates) {
      return;
    }
    const newBundleVersion = platform.value.availableUpdates[0].version;
    try {
      upsertProcess(null, {
        procType: 'downloading',
        version: newBundleVersion,
        progressValue: 0,
      });
      platform.value.updateInProcess = {
        version: newBundleVersion,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let errEvent: any;
      downloader.setupUpdater(newBundleVersion, {
        next: ev => {
          if (ev.event === 'download-progress') {
            upsertProcess(null, {
              procType: 'downloading',
              version: newBundleVersion,
              progressValue: Math.floor(ev.info.percent),
            });
            platform.value.updateInProcess!.progress = ev.info;
          }
          console.log(ev);
        },
        error: err => {
          errEvent = err;
        },
      });

      await sleep(10);
      if (errEvent) {
        throw errEvent;
      }

      const files = await downloader.downloadUpdate();
      if (files) {
        setPlatformRestart(true);
      }
      delete platform.value.updateInProcess;
    } finally {
      if (restart.value?.platform) {
        delProcess(null, 'downloading', {
          'platform:restart-to-update': null,
        });
      } else {
        delProcess(null, 'downloading');
      }
    }
  });

  return {
    platform,

    downloadPlatformUpdate,
  };
}
