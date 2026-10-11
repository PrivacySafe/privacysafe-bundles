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
import { randomStr } from '../../../src/utils/random.ts';
import { makeFolder } from '../../../shared/utils/fs-utils/index.ts';
import { updateXAttrs } from './actions-on-x-attrs.ts';
import { USER_FS, USER_LOCAL_FS } from '../../../shared/constants/index.ts';
import type { FsListItem } from '../../../shared/types/index.ts';

export async function createFolderInFS({
  fsListItem,
  path,
}: {
  fsListItem: FsListItem;
  path: string;
}): Promise<string | undefined> {
  try {
    if (path.toLowerCase() === 'root') {
      console.warn('🚫 You cannot create a folder named ROOT. It is a reserved folder.');
      return;
    }

    const { entity: fs, fsId } = fsListItem;
    await makeFolder({ fs, path });

    if (fsId === USER_FS || fsId === USER_LOCAL_FS) {
      const nodeId = randomStr(24);
      await updateXAttrs({ fs, path, attrs: { id: nodeId } });
      return nodeId;
    }
  } catch (e) {
    if (!(e as web3n.files.FSSyncException).childNeverUploaded) {
      w3n.log!('error', `Error making folder ${path}. `, e);
      throw e;
    }
  }
}
