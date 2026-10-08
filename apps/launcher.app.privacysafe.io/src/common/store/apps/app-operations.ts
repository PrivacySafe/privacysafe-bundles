/*
 Copyright (C) 20243NSoft Inc.

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

import { ProcessesPlace } from '@/common/store/apps/processes';
import { defer } from '@v1nt1248/3nclient-lib/utils';

type PostInstallState = web3n.system.apps.PostInstallState;

export async function installApp(
  appId: string,
  version: string,
  delProcess: ProcessesPlace['delProcess'],
  upsertProcess: ProcessesPlace['upsertProcess'],
): Promise<PostInstallState> {
  try {
    upsertProcess(appId, {
      procType: 'installing',
      version,
    });
    const postInstallState = await w3n.system!.apps!.installer!.installApp(appId, version);
    return postInstallState;
    // eslint-disable-next-line no-useless-catch
  } catch (err) {
    throw err;
  } finally {
    delProcess(appId, 'installing');
  }
}

export async function downloadApp(
  appId: string,
  version: string,
  delProcess: ProcessesPlace['delProcess'],
  upsertProcess: ProcessesPlace['upsertProcess'],
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  const deferred = defer<void>();
  upsertProcess(appId, {
    procType: 'downloading',
    version,
    progressValue: 0,
  });
  w3n.system!.apps!.downloader!.downloadWebApp(appId, version, {
    next: ev => {
      const { totalBytes, bytesLeft } = ev;
      const progressValue = Math.floor(((totalBytes - bytesLeft) / totalBytes) * 100);
      upsertProcess(appId, {
        procType: 'downloading',
        version,
        progressValue,
      });
    },
    complete: () => {
      deferred.resolve();
    },
    error: err => deferred.reject(err),
  });
  try {
    await deferred.promise;
  } finally {
    delProcess(appId, 'downloading');
  }
}
