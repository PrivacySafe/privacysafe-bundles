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

type WritableFS = web3n.files.WritableFS;
type FileException = web3n.files.FileException;

import { SingleProc } from '@v1nt1248/3nclient-lib/utils';

interface SavedConfs {
  formatVer: 1;
  autoUpdate: boolean;
}

const confsPath = 'confs.json';

export function makeConfs() {
  const data: SavedConfs = {
    formatVer: 1,
    autoUpdate: true,
  };
  let fs: WritableFS | undefined = undefined;
  const refreshProc = new SingleProc();

  async function init(): Promise<void> {
    return refreshProc.start(async () => {
      fs = await w3n.storage!.getAppSyncedFS!();
      try {
        const { formatVer, autoUpdate } = await fs.readJSONFile<SavedConfs>(confsPath);
        if (formatVer === 1) {
          data.autoUpdate = autoUpdate;
        } else {
          await fs!.writeJSONFile(confsPath, data);
        }
      } catch (exc) {
        if (!(exc as FileException).notFound) {
          throw exc;
        }
        await fs!.writeJSONFile(confsPath, data);
      }
    });
  }

  async function getAutoUpdate(): Promise<SavedConfs['autoUpdate']> {
    await refreshProc.getP();
    return data.autoUpdate;
  }

  async function setAutoUpdate(value: boolean): Promise<void> {
    await refreshProc.startOrChain(async () => {
      if (data.autoUpdate !== value) {
        data.autoUpdate = value;
        await fs!.writeJSONFile(confsPath, data);
      }
    });
  }

  return {
    init,
    getAutoUpdate,
    setAutoUpdate,
  };
}
