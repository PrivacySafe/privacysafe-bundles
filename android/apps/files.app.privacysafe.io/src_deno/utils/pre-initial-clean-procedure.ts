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
import { DB_FILE } from '../constants.ts';

export async function preInitialCleanProcedure(trashFolderName: string): Promise<{
  userSyncedFs: web3n.files.WritableFS;
  userLocalFs: web3n.files.WritableFS;
  appSyncedFs: web3n.files.WritableFS;
}> {
  const appSyncedFs = await w3n.storage!.getAppSyncedFS();
  const isPresentDbFile = await appSyncedFs.checkFilePresence(DB_FILE);
  if (isPresentDbFile) {
    await appSyncedFs.deleteFile(DB_FILE);
  }

  const fsSyncedItem = await w3n.storage!.getUserFS!('synced');
  const fsLocalItem = await w3n.storage!.getUserFS!('local');

  const userSyncedFs = fsSyncedItem.item as web3n.files.WritableFS;
  const userLocalFs = fsLocalItem.item as web3n.files.WritableFS;

  const doesUserSyncedFsContainTrashFolder = await userSyncedFs.checkFolderPresence(trashFolderName);
  const doesUserLocalFsContainTrashFolder = await userLocalFs.checkFolderPresence(trashFolderName);

  if (!doesUserSyncedFsContainTrashFolder) {
    await userSyncedFs.makeFolder(trashFolderName);
  }

  if (!doesUserLocalFsContainTrashFolder) {
    await userLocalFs.makeFolder(trashFolderName);
  }

  return {
    userSyncedFs,
    userLocalFs,
    appSyncedFs,
  };
}
