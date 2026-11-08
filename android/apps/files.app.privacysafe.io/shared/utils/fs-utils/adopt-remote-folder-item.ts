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
import { makeLogger } from '../logger.ts';

const log = makeLogger('FsUtils');

export async function adoptRemoteFolderItem({
  fs,
  path,
  remoteItemName,
  opts,
  stopErrorPropagate,
}: {
  fs: web3n.files.WritableFS,
  path: string;
  remoteItemName: string;
  opts?: web3n.files.OptionsToAdoptRemoteItem,
  stopErrorPropagate?: boolean;
}): Promise<number | undefined> {
  try {
    return await fs.v?.sync?.adoptRemoteFolderItem(path, remoteItemName, opts);
  } catch (err) {
    log.error(
      `🔥 [adoptRemoteFolderItem] Error in the process for the FS object '${path}'. 'stopErrorPropagate' flag is ${stopErrorPropagate} .`,
      err,
    );
    if (!stopErrorPropagate) {
      throw err;
    }

    return undefined;
  }
}
