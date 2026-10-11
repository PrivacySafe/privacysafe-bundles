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
import type { FileStoreService } from '../../types/index.ts';
import { SingleProc } from '../../../shared-libs/processes/single.ts';
import { randomStr } from '../../../shared-libs/randomStr.ts';
import { getFileExtension } from '../../../shared-libs/get-file-extension.ts';

export async function fileStoreService(): Promise<FileStoreService> {
  const fileProc = new SingleProc();
  let fs: web3n.files.WritableFS | undefined;

  const initializing = async (): Promise<void> => {
    fs = await w3n.storage?.getAppLocalFS();
  };

  const checkFs = async (): Promise<void> => {
    if (!fs) {
      await initializing();
    }
  };

  const saveFile = async (data: ArrayBuffer, fileName?: string): Promise<string> => {
    let entityId = `file-${randomStr(15)}`;
    if (fileName) {
      const ext = getFileExtension(fileName);
      const updatedFileName = fileName.replace(`.${ext}`, '');
      entityId = `${updatedFileName}-${randomStr(3)}.${ext}`;
    }

    await checkFs();
    const uint8Array = new Uint8Array(data);
    // Not caught here: an id handed back for bytes that were never written
    // reads as a stored file that then cannot be found, and the caller has no
    // way to tell that from a working one.
    await fileProc.startOrChain(() => fs!.writeBytes(entityId, uint8Array));

    return entityId;
  };

  const saveCopy = async (entity: web3n.files.ReadonlyFile | web3n.files.ReadonlyFS): Promise<string> => {
    const entityId = randomStr(20);
    const isFolder = !!(entity as web3n.files.ReadonlyFS).listFolder;

    await checkFs();
    await fileProc.startOrChain(() =>
      isFolder
        ? fs!.saveFolder(entity as web3n.files.ReadonlyFS, entityId)
        : fs!.saveFile(entity as web3n.files.ReadonlyFile, entityId),
    );

    return entityId;
  };

  const saveLink = async (entity: web3n.files.ReadonlyFile | web3n.files.ReadonlyFS): Promise<string> => {
    const entityId = randomStr(20);
    const isFolder = !!(entity as web3n.files.ReadonlyFS).listFolder;

    try {
      await checkFs();
      await fileProc.startOrChain(() => fs!.link(entityId, entity));
    } catch (e) {
      // FileException
      // eslint-disable-next-line
      const { notLinkableFile, notLinkableFolder } = e as any;
      // Some entities cannot be linked to at all, and for those a copy is the
      // only way to store them - unlike the size-driven choice made by the
      // caller, this one is forced.
      if ((notLinkableFile && !isFolder) || (notLinkableFolder && isFolder)) {
        await fileProc.startOrChain(() =>
          isFolder
            ? fs!.saveFolder(entity as web3n.files.ReadonlyFS, entityId)
            : fs!.saveFile(entity as web3n.files.ReadonlyFile, entityId),
        );
        return entityId;
      }

      // Deliberately thrown on, not logged and forgotten: returning the id of
      // an item that was never created leaves a message record pointing at
      // nothing, with nothing to tell it apart from a working attachment.
      throw e;
    }

    return entityId;
  };

  const getLink = async (entityId: string): Promise<web3n.files.SymLink | null | undefined> => {
    try {
      await checkFs();
      return await fileProc.startOrChain(() => fs!.readLink(entityId));
    } catch (e) {
      w3n.log('error', `Error getting link ${entityId}.`, e);
      const { notFound, path } = e as web3n.files.FileException;
      if (path === entityId && notFound) {
        return null;
      }
    }
  };

  const getFile = async (entityId: string): Promise<web3n.files.File | web3n.files.FS | null | undefined> => {
    try {
      await checkFs();
      const stat = await fs!.stat(entityId);
      if (stat.isLink) {
        const link = await getLink(entityId);
        if (link && link.isFile) {
          return (await link.target()) as web3n.files.File;
        }
        if (link && link.isFolder) {
          return (await link.target()) as web3n.files.FS;
        }
        return null;
      }

      if (stat.isFile) {
        return await fileProc.startOrChain(() => fs!.readonlyFile(entityId));
      }

      return await fileProc.startOrChain(() => fs!.readonlySubRoot(entityId));
    } catch (e) {
      w3n.log('error', `Error getting file ${entityId}.`, e);
    }
  };

  const statEntity: FileStoreService['statEntity'] = async entityId => {
    try {
      await checkFs();
      const stat = await fileProc.startOrChain(() => fs!.stat(entityId));
      return {
        isLink: !!stat.isLink,
        isFile: !!stat.isFile,
        isFolder: !!stat.isFolder,
        ...(stat.size !== undefined && { size: stat.size }),
      };
    } catch (e) {
      // Not logged as an error: a backup asks this about every attachment
      // there is, and an item the user has since removed is an ordinary
      // outcome, not a fault.
      return undefined;
    }
  };

  const listFolderEntity: FileStoreService['listFolderEntity'] = async entityId => {
    try {
      await checkFs();
      const entity = await getFile(entityId);
      if (!entity || !(entity as web3n.files.FS).listFolder) {
        return undefined;
      }
      const folder = entity as web3n.files.FS;
      const res: { path: string; size: number }[] = [];

      const walk = async (relPath: string): Promise<void> => {
        const items = await folder.listFolder(relPath || '.');
        for (const item of items) {
          const itemPath = relPath ? `${relPath}/${item.name}` : item.name;
          if (item.isFolder) {
            await walk(itemPath);
          } else {
            // A link inside a copied folder points outside the store, exactly
            // as a top-level link does, and is left out for the same reason.
            if (item.isLink) {
              continue;
            }
            const stat = await folder.stat(itemPath).catch(() => undefined);
            res.push({ path: itemPath, size: stat?.size ?? 0 });
          }
        }
      };

      await walk('');
      return res;
    } catch (e) {
      w3n.log('error', `Error listing stored folder ${entityId}.`, e);
      return undefined;
    }
  };

  const saveFolderOfBytes: FileStoreService['saveFolderOfBytes'] = async (entries, folderName) => {
    const entityId = folderName ? `${folderName}-${randomStr(3)}` : randomStr(20);

    await checkFs();
    // Thrown on, like saveFile: an id handed back for a folder that is not
    // there reads as a restored attachment that then cannot be opened.
    await fileProc.startOrChain(async () => {
      await fs!.makeFolder(entityId);
      for (const { path, bytes } of entries) {
        await fs!.writeBytes(`${entityId}/${path}`, bytes);
      }
    });

    return entityId;
  };

  const deleteEntity = async (entityId: string): Promise<void> => {
    try {
      await checkFs();
      // What the item is has to be asked before deleting it: an attachment can
      // be a link, a copied file or a copied folder, and deleteLink is the only
      // one of the three that used to be called here - which left every copy
      // behind when its message was deleted.
      const stat = await fileProc.startOrChain(() => fs!.stat(entityId));
      await fileProc.startOrChain(() => {
        if (stat.isLink) {
          return fs!.deleteLink(entityId);
        }
        return stat.isFolder ? fs!.deleteFolder(entityId, true) : fs!.deleteFile(entityId);
      });
    } catch (e) {
      w3n.log('error', `Error deleting stored entity ${entityId}.`, e);
    }
  };

  await initializing();

  return {
    saveFile,
    saveCopy,
    saveLink,
    saveFolderOfBytes,
    getLink,
    getFile,
    statEntity,
    listFolderEntity,
    deleteEntity,
  };
}
