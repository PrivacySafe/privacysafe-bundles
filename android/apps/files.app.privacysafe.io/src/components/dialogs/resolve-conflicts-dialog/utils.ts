/*
 Copyright (C) 2025-2026 3NSoft Inc.

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
import isEmpty from 'lodash/isEmpty';
import { getListFolder, getFsStat, getRemoteFileItem, getRemoteFolderItem } from '@shared/utils/fs-utils';
import { useAppStore } from '@/store';
import type { FolderListItem } from './types';
import { EntitySyncStatus } from '@deno/types.ts';

function getEntryType(entry: web3n.files.ListingEntry): 'file' | 'folder' | 'link' {
  return entry.isFile ? 'file' : entry.isFolder ? 'folder' : 'link';
}

async function prepareLocalFolderTree({
  fs,
  folderPath,
  diff,
  parentDiversity,
  trashFolder,
}: {
  fs: web3n.files.WritableFS | web3n.files.ReadonlyFS;
  folderPath: string;
  diff?: web3n.files.FolderDiff | undefined;
  parentDiversity?: boolean;
  trashFolder: string;
}): Promise<FolderListItem[]> {
  const { added = {}, removed = {}, renamed = [], nameOverlaps = [] } = diff || {};

  const entries = await getListFolder({ fs, folderName: folderPath, vAPI: false });

  const list: FolderListItem[] = [];
  if (!entries) {
    return list;
  }

  for (const entity of entries) {
    const { isFolder, name } = entity;
    if (isFolder && name === trashFolder) {
      continue;
    }

    const currentEntityFullPath = `${folderPath}/${name}`;
    const entityType = getEntryType(entity);

    let diversity = false;

    const isInAdded = isEmpty(added.inLocal) ? false : !!(added.inLocal || []).find(item => entity.name === item);
    const isInNameOverlaps = nameOverlaps.includes(entity.name);
    const isInRenamed = renamed.find(item => {
      const { local, renamedIn } = item;
      return ['l', 'l&r'].includes(renamedIn) && entity.name === local;
    });
    const isInRemoved = isEmpty(removed.inRemote)
      ? false
      : !!(removed.inRemote || []).find(item => entity.name === item);

    (isInAdded || isInRemoved || isInNameOverlaps || isInRenamed) && (diversity = true);

    const stats = await getFsStat({ fs, path: currentEntityFullPath, stopErrorPropagate: true }).catch(
      () => undefined,
    );

    const item = {
      name,
      type: entityType,
      ...(stats?.size && { size: stats.size }),
      mtime: stats?.mtime,
      ...(stats?.bytesNeedDownload && { bytesNeedDownload: stats.bytesNeedDownload }),
      ...((diversity || parentDiversity) && { diversity: diversity || parentDiversity }),
      ...(isFolder && {
        children: await prepareLocalFolderTree({
          fs,
          folderPath: currentEntityFullPath,
          parentDiversity: diversity || parentDiversity,
          trashFolder,
        }),
      }),
    };
    list.push(item);
  }

  return list.sort((a, b) => (a.type > b.type ? -1 : 1));
}

async function processRemoteFolder(
  folderFs: web3n.files.ReadonlyFS,
  folderPath: string,
  parentDiversity?: boolean,
): Promise<FolderListItem[]> {
  const list: FolderListItem[] = [];

  console.log(`PROCESS REMOTE FOLDER [${folderPath}]`);
  const folderList = await folderFs.listFolder(folderPath);
  console.log(`PROCESS REMOTE FOLDER LIST [${folderPath}] => `, folderList);
  for (const entity of folderList) {
    const { isFolder, name } = entity;
    const currentEntityFullPath = `${folderPath}/${name}`;
    const entityType = getEntryType(entity);
    const stats = await folderFs.stat(currentEntityFullPath);
    const item = {
      name,
      type: entityType,
      ...(stats.size && { size: stats.size }),
      mtime: stats.mtime,
      ...(stats.bytesNeedDownload && { bytesNeedDownload: stats.bytesNeedDownload }),
      diversity: parentDiversity,
      ...(isFolder && {
        children: await processRemoteFolder(folderFs, currentEntityFullPath, parentDiversity),
      }),
    };

    list.push(item);
  }

  return list.sort((a, b) => (a.type > b.type ? -1 : 1));
}

async function prepareRemoteFolderTree({
  fs,
  folderPath,
  syncStatus,
  diff,
  trashFolder,
}: {
  fs: web3n.files.WritableFS | web3n.files.ReadonlyFS;
  folderPath: string;
  syncStatus: EntitySyncStatus | undefined;
  diff?: web3n.files.FolderDiff | undefined;
  trashFolder: string;
}): Promise<FolderListItem[]> {
  const { added = {}, removed = {}, renamed = [], nameOverlaps = [] } = diff || {};

  const res = await getListFolder({
    fs,
    folderName: folderPath,
    ...(syncStatus?.remote?.latest && { flags: { remoteVersion: syncStatus.remote.latest } }),
    vAPI: true,
  });

  const list: FolderListItem[] = [];

  for (const entity of res?.lst || []) {
    const { isFolder, isFile, name } = entity;
    if (isFolder && name === trashFolder) {
      continue;
    }

    let diversity = false;

    const isInAdded = isEmpty(added.inRemote)
      ? false
      : !!(added.inRemote || []).find(item => entity.name === item);
    const isInNameOverlaps = nameOverlaps.includes(entity.name);
    const isInRenamed = renamed.find(item => {
      const { local, renamedIn } = item;
      return ['r', 'l&r'].includes(renamedIn) && entity.name === local;
    });
    const isInRemoved = isEmpty(removed.inLocal)
      ? false
      : !!(removed.inLocal || []).find(item => entity.name === item);

    (isInAdded || isInRemoved || isInNameOverlaps || isInRenamed) && (diversity = true);

    if (isFile) {
      const file = await getRemoteFileItem({
        fs,
        path: folderPath,
        remoteItemName: name,
        ...(syncStatus?.remote?.latest && { remoteVersion: syncStatus.remote.latest  }),
        stopErrorPropagate: true,
      });

      if (file) {
        const stats = await file.stat();
        list.push({
          name,
          type: 'file' as const,
          ...(stats.size && { size: stats.size }),
          mtime: stats.mtime,
          diversity,
        });
      }
    } else if (isFolder) {
      const remoteFolderFs = await getRemoteFolderItem({
        fs,
        path: folderPath,
        remoteItemName: name,
        ...(syncStatus?.remote?.latest && { remoteVersion: syncStatus.remote.latest }),
        stopErrorPropagate: true,
      });

      if (remoteFolderFs) {
        const stats = await remoteFolderFs.stat('');
        const treeItem = {
          name,
          type: 'folder' as const,
          mtime: stats.mtime,
          diversity,
          children: await processRemoteFolder(remoteFolderFs, '', diversity),
        };
        list.push(treeItem);
      }
    }
  }

  return list.sort((a, b) => (a.type > b.type ? -1 : 1));
}

export async function prepareComparativeFolderTree(
  fs: web3n.files.WritableFS,
  folderPath: string,
  syncStatus: EntitySyncStatus | undefined,
  diff: web3n.files.FolderDiff | undefined,
): Promise<{ localFolderTree: FolderListItem[]; remoteFolderTree: FolderListItem[] }> {
  const appStore = useAppStore();
  const trashFolder = `.trash-folder-${appStore.user}`;

  const localFolderTree = await prepareLocalFolderTree({ fs, folderPath, diff, trashFolder });
  const remoteFolderTree = await prepareRemoteFolderTree({ fs, folderPath, syncStatus, diff, trashFolder }).catch(
    e => console.error(e),
  );

  return {
    localFolderTree,
    remoteFolderTree: remoteFolderTree || [],
  };
}
