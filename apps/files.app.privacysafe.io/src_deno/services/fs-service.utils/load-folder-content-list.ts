/*
 Copyright (C) 2026 3NSoft Inc.

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
/// <reference path="../../../@types/platform-defs/injected-w3n.d.ts" />
import { getListFolder } from '../../../shared/utils/fs-utils/index.ts';
import type { ListingEntry } from '../../../shared/types/index.ts';

function handleError(err: unknown) {
  const errorMessage = `Error in 'loadFolderContentList' method. `;
  console.error(errorMessage, err);
  w3n.log!('error', errorMessage, err);
  return [];
}

export async function loadFolderContentList({
  fs,
  path,
  version,
}: {
  fs: web3n.files.WritableFS;
  path: string;
  version?: number;
}): Promise<ListingEntry[]> {
  const isThisFsWithVersioned = !!version && !!fs.v;

  if (isThisFsWithVersioned) {
    const res = await getListFolder({
      fs,
      folderName: path,
      flags: { remoteVersion: version },
      vAPI: true,
      stopErrorPropagate: true,
      actionIfError: err => handleError(err),
    });

    return res?.lst || [];
  }

  const res = await getListFolder({
    fs,
    folderName: path,
    vAPI: false,
    stopErrorPropagate: true,
    actionIfError: err => handleError(err),
  });
  return res || [];
}
