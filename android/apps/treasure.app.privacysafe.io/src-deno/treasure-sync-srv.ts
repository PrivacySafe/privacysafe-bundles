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
import { checkSyncFsState } from './utils/check-sync-fs-state.ts';
import type { TreasureFileSrv } from '@deno/srv.types.ts';
import type { TreasureEvent } from '../shared/@types';

async function isConnectionOnline() {
  return ((await w3n.connectivity?.isOnline()) || '').includes('online');
}

export async function treasureSyncSrv({
  fs,
  fileSrv,
  emitEvent,
}: {
  fs: web3n.files.WritableFS;
  fileSrv: TreasureFileSrv;
  emitEvent: (event: TreasureEvent) => void;
}) {
  let isOnlinePrev = await isConnectionOnline();
  w3n.connectivity!.watch({
    next: async event => {
      const { isOnline } = event;
      if (isOnline && !isOnlinePrev) {
        // console.info('🚀 CONNECTION RESTORED 🚀');
        checkSyncFsState({ fs, fileSrv, emitEvent });
      }

      isOnlinePrev = isOnline;
    },
    error: err => {
      console.error('🔥 CONNECTIVITY WATCHING ERROR. ', err);
    },
  });
}
