/*
 Copyright (C) 2024-2026 3NSoft Inc.

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
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NamedProcs } from '../../../shared/utils/processes/named-procs.ts';
import { generateFastRandomString } from '../../../shared/utils/generate-random-string.ts';

type FileException = web3n.files.FileException;
type XAttrsChanges = web3n.files.XAttrsChanges;
type WritableFS = web3n.files.WritableFS;
type ReadonlyFS = web3n.files.ReadonlyFS;

export interface LabelledFileStore {
  addBlob(blob: Blob, info?: ItemAttrs): Promise<string>;
  /**
   * Same as addBlob, without a Blob.
   *
   * This exists because of where this component runs: on Android a
   * `runtime: "deno"` component is executed by androidx.javascriptengine - a
   * bare V8 isolate with no Web APIs, where `Blob` is as absent as `crypto`.
   * Restoring an attachment out of a backup archive has nothing but bytes, and
   * wrapping them in a Blob just to unwrap them inside would put the one path
   * that writes archived bytes on an API that is not there.
   */
  addBytes(bytes: Uint8Array, type: string, info?: ItemAttrs): Promise<string>;
  addFile(file: web3n.files.ReadonlyFile, info?: ItemAttrs): Promise<string>;
  /**
   * Takes a reference to a file that stays where it is, instead of a copy of it.
   * Used for attachments too big to be worth duplicating: the bytes are read
   * from their original place when they are needed.
   *
   * The item behaves like any other from the outside - same ids, attributes and
   * reference counting - but it is only as good as its target, which the store
   * does not own. A target that the user has deleted, moved or renamed makes the
   * item read as not found.
   */
  addLink(file: web3n.files.ReadonlyFile, info?: ItemAttrs): Promise<string>;
  addFolder(folder: ReadonlyFS, info?: ItemAttrs): Promise<string>;
  getBlob(id: string): Promise<Blob>;
  getFile(id: string): Promise<web3n.files.ReadonlyFile>;
  downloadFile(id: string, targetFile: web3n.files.WritableFile): Promise<void>;
  downloadFiles(ids: string[], fs: web3n.files.WritableFS): Promise<void>;
  getFolderRO(id: string): Promise<ReadonlyFS>;
  getFolderWR(id: string): Promise<WritableFS>;
  updateBlob(id: string, blob: Blob): Promise<void>;
  updateInfo(id: string, info: ItemAttrs): Promise<void>;
  getInfo(id: string): Promise<FileInfo | FolderInfo>;
  delete(id: string): Promise<void>;
}

export interface ItemAttrs {
  fileName?: string;
  messages?: string[];
}

export interface ItemInfo extends ItemAttrs {
  id: string;
  version: number;
  ctime: Date;
  mtime: Date;
}

export interface FileInfo extends ItemInfo {
  isFile: true;
  size: number;
  type: string;
}

export interface FolderInfo extends ItemInfo {
  isFolder: true;
}

export async function makeLabelledFileStoreIn(pathInAppFSs: string): Promise<LabelledFileStore> {
  const localFS = await w3n.storage!.getAppLocalFS().then(fs => fs.writableSubRoot(pathInAppFSs));
  return await makeLabelledFileStore(localFS);
}

export interface FileStoreException extends web3n.RuntimeException {
  type: 'labelled-file-store';
  notFound?: true;
  notBlob?: true;
  notFile?: true;
  notDirectory?: true;
}

function makeExc(fields: Partial<FileStoreException>): FileStoreException {
  const exc: FileStoreException = {
    runtimeException: true,
    type: 'labelled-file-store',
  };
  for (const [field, value] of Object.entries(fields)) {
    (exc as any)[field] = value;
  }
  return exc;
}

function wrapErr(err: any, message: string): FileStoreException {
  return makeExc({ cause: err, message });
}

const ID_ATTR_NAME = 'lfs:id';
const TYPE_ATTR_NAME = 'lfs:type';

const BUCKET_TOP_COUNT = 200;

const DATA_FOLDER_NAME = 'lfs_data';
const LAST_BUCKET_FNAME = 'lfs_last-bucket';
const FILE_NAME_LEN = 4;
const FOLDER_NAME_LEN = 2;
const FOLDER_DEPTH = 3;

/**
 * A store of files and folders addressed by an opaque id, with a few attributes
 * attached to each item.
 *
 * Everything lives in the local fs: attachments can be gigabytes, and a synced
 * versioned store is the wrong place for them. Items written before that was so
 * are moved over on start, see `migrate-to-local-fs.ts`.
 *
 * @param localFS root of the store, both for content (`lfs_data/`) and for the
 * record of the bucket new ids are made in.
 */
export async function makeLabelledFileStore(localFS: WritableFS): Promise<LabelledFileStore> {
  if (!localFS.v) {
    throw new Error(`Store needs versioned fs for data, while given one isn't.`);
  }
  if (localFS.type !== 'local') {
    throw new Error(`Store needs local fs for data, while given one isn't.`);
  }

  const dataFS = await localFS.writableSubRoot(DATA_FOLDER_NAME);
  const procs = new NamedProcs();

  let bucket: string | undefined = undefined;
  let bucketCount = 0;

  async function setBucket(): Promise<void> {
    try {
      if (bucket) {
        bucket = await newBucketInTree(dataFS, bucket);
        bucketCount = 0;
      } else {
        const lastBucket = await localFS.readTxtFile(LAST_BUCKET_FNAME).catch((exc: FileException) => {
          if (!exc.notFound) {
            throw exc;
          }
        });
        // An unreadable record is not a reason to fail: the bucket it names may
        // belong to content that is not here, and a fresh tree costs nothing.
        const count = lastBucket
          ? await dataFS
              .listFolder(lastBucket)
              .then(list => list.length)
              .catch(() => undefined)
          : undefined;
        if (!lastBucket || count === undefined) {
          await localFS.deleteFile(LAST_BUCKET_FNAME).catch(noop);
          bucket = await newBucketTree(dataFS);
          bucketCount = 0;
        } else {
          bucket = lastBucket;
          bucketCount = count;
          if (bucketCount > BUCKET_TOP_COUNT) {
            bucket = await newBucketInTree(dataFS, bucket);
            bucketCount = 0;
          }
        }
      }
      await localFS.writeTxtFile(LAST_BUCKET_FNAME, bucket);
    } catch (err) {
      throw wrapErr(err, `Fail to set store bucket`);
    }
  }

  async function generateId(): Promise<string> {
    if (!bucket || bucketCount > BUCKET_TOP_COUNT) {
      await setBucket();
    }
    return `${bucket}/${generateFastRandomString(FILE_NAME_LEN)}`;
  }

  async function addBytes(bytes: Uint8Array, type: string, info?: ItemAttrs): Promise<string> {
    try {
      const id = await generateId();
      await dataFS.writeBytes(id, bytes, { create: true, exclusive: true });
      bucketCount += 1;
      const attrsChanges = info && Object.keys(info).length > 0 ? infoToAttrChanges(info) : { set: {} };
      attrsChanges.set![ID_ATTR_NAME] = id;
      attrsChanges.set![TYPE_ATTR_NAME] = type;
      await dataFS.updateXAttrs(id, attrsChanges);
      return id;
    } catch (exc) {
      if ((exc as FileException).alreadyExists || (exc as FileException).isDirectory) {
        return addBytes(bytes, type, info);
      } else {
        throw wrapErr(exc, `Fail to save file`);
      }
    }
  }

  async function addBlob(blob: Blob, info?: ItemAttrs): Promise<string> {
    return addBytes(new Uint8Array(await blob.arrayBuffer()), blob.type, info);
  }

  async function addFile(file: web3n.files.ReadonlyFile, info?: ItemAttrs): Promise<string> {
    try {
      const id = await generateId();
      await dataFS.saveFile(file, id);
      bucketCount += 1;
      const attrsChanges = info && Object.keys(info).length > 0 ? infoToAttrChanges(info) : { set: {} };
      attrsChanges.set![ID_ATTR_NAME] = id;
      await dataFS.updateXAttrs(id, attrsChanges);
      return id;
    } catch (exc) {
      if ((exc as FileException).alreadyExists || (exc as FileException).isDirectory) {
        return addFile(file, info);
      } else {
        throw wrapErr(exc, `Fail to save file`);
      }
    }
  }

  async function addLink(file: web3n.files.ReadonlyFile, info?: ItemAttrs): Promise<string> {
    try {
      const id = await generateId();
      // Creates the missing bucket folders on the way, like saveFile does.
      await dataFS.link(id, file);
      bucketCount += 1;
      const attrsChanges = info && Object.keys(info).length > 0 ? infoToAttrChanges(info) : { set: {} };
      attrsChanges.set![ID_ATTR_NAME] = id;
      await dataFS.updateXAttrs(id, attrsChanges);
      return id;
    } catch (exc) {
      if ((exc as FileException).alreadyExists) {
        return addLink(file, info);
      } else {
        throw wrapErr(exc, `Fail to save link to a file`);
      }
    }
  }

  async function addFolder(folder: ReadonlyFS, info?: ItemAttrs): Promise<string> {
    try {
      const id = await generateId();
      await dataFS.saveFolder(folder, id);
      bucketCount += 1;
      const attrsChanges = info && Object.keys(info).length > 0 ? infoToAttrChanges(info) : { set: {} };
      attrsChanges.set![ID_ATTR_NAME] = id;
      await dataFS.updateXAttrs(id, attrsChanges);
      return id;
    } catch (exc) {
      if ((exc as FileException).alreadyExists || (exc as FileException).notDirectory) {
        return addFolder(folder, info);
      } else {
        throw wrapErr(exc, `Fail to save folder`);
      }
    }
  }

  async function updateBlob(id: string, blob: Blob): Promise<void> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await dataFS.writeBytes(id, bytes, { create: false }).catch((exc: FileException) => {
      if (exc.notFound) {
        throw makeExc({ notFound: true });
      } else if (exc.notFile) {
        throw makeExc({ notBlob: true });
      } else {
        throw wrapErr(exc, `Fail to update content of ${id}`);
      }
    });
    const attrsChanges: XAttrsChanges = { set: {} };
    attrsChanges.set![TYPE_ATTR_NAME] = blob.type;
    await dataFS.updateXAttrs(id, attrsChanges);
  }

  async function updateInfo(id: string, info: ItemAttrs): Promise<void> {
    const attrsChanges = infoToAttrChanges(info);
    await dataFS.updateXAttrs(id, attrsChanges).catch((exc: FileException) => {
      if (exc.notFound) {
        throw makeExc({ notFound: true });
      } else {
        throw wrapErr(exc, `Fail to update info of ${id}`);
      }
    });
  }

  async function getBlob(id: string): Promise<Blob> {
    const bytes = await dataFS.readBytes(id).catch((exc: FileException) => {
      if (exc.notFound) {
        throw makeExc({ notFound: true });
      } else if (exc.notFile) {
        throw makeExc({ notBlob: true });
      } else {
        throw wrapErr(exc, `Fail to read content of ${id}`);
      }
    });
    const type = (await dataFS.getXAttr(id, TYPE_ATTR_NAME)) as string;
    return new Blob([bytes ? (bytes as BlobPart) : new Uint8Array()], { type });
  }

  /**
   * The target a link item points at.
   *
   * A broken target is reported as not found: from the caller's point of view
   * there is nothing to read, and it makes no difference whether the item never
   * existed or its file has been deleted or moved.
   */
  async function linkTargetOf(id: string): Promise<web3n.files.ReadonlyFile> {
    const link = await dataFS.readLink(id).catch((exc: FileException) => {
      if (exc.notFound) {
        throw makeExc({ notFound: true });
      }
      throw wrapErr(exc, `Fail to read link of ${id}`);
    });
    if (!link.isFile) {
      throw makeExc({ notFile: true, message: `Item ${id} links to something that is not a file` });
    }
    const target = await link.target().catch(() => {
      throw makeExc({ notFound: true, message: `File linked to by ${id} cannot be reached` });
    });
    return target as web3n.files.ReadonlyFile;
  }

  /**
   * Falls back to a link instead of checking what the item is first: an ordinary
   * file is the common case, and a presence check ahead of every read is exactly
   * the per-read cost that came out of this store when legacy routing went away.
   */
  async function fileOf(id: string): Promise<web3n.files.ReadonlyFile> {
    try {
      return await dataFS.readonlyFile(id);
    } catch (exc) {
      if (!(exc as FileException).notFile) {
        throw exc;
      }
    }
    return linkTargetOf(id);
  }

  async function getFile(id: string): Promise<web3n.files.ReadonlyFile> {
    return fileOf(id).catch((exc: any) => {
      // linkTargetOf already reports in this store's own terms.
      if ((exc as FileStoreException).type === 'labelled-file-store') {
        throw exc;
      } else if ((exc as FileException).notFound) {
        throw makeExc({ notFound: true });
      } else {
        throw wrapErr(exc, `Fail to get file of ${id}`);
      }
    });
  }

  async function downloadFile(id: string, targetFile: web3n.files.WritableFile): Promise<void> {
    try {
      const file = await getFile(id);
      await targetFile.copy(file);
    } catch (err) {
      w3n.log('error', `Error while downloading file with ID ${id}`, err);
      // Rethrown, or the caller reports a save that did not happen as a success.
      throw wrapErr(err, `Fail to download file with id ${id}`);
    }
  }

  async function downloadFiles(ids: string[], fs: web3n.files.WritableFS): Promise<void> {
    // Every id is attempted: one attachment whose file is gone must not cost the
    // user the other ones, which used to happen when the first failure threw.
    const failedIds: string[] = [];
    let lastErr: unknown;
    for (const id of ids) {
      try {
        const file = await getFile(id);
        const fileName = await file.getXAttr('fileName');
        await fs.saveFile(file, fileName);
      } catch (err) {
        failedIds.push(id);
        lastErr = err;
        w3n.log('error', `Error while downloading file with ID ${id}`, err);
      }
    }
    if (failedIds.length > 0) {
      // Rethrown, or the caller reports a save that did not happen as a success.
      throw wrapErr(lastErr, `Fail to download files with ids ${failedIds.join(', ')}`);
    }
  }

  async function getFolderRO(id: string): Promise<ReadonlyFS> {
    return dataFS.readonlySubRoot(id).catch((exc: FileException) => {
      if (exc.notFound) {
        throw makeExc({ notFound: true });
      } else if (exc.notDirectory) {
        throw makeExc({ notDirectory: true });
      } else {
        throw wrapErr(exc, `Fail to get folder of ${id}`);
      }
    });
  }

  async function getFolderWR(id: string): Promise<WritableFS> {
    return dataFS.writableSubRoot(id).catch((exc: FileException) => {
      if (exc.notFound) {
        throw makeExc({ notFound: true });
      } else if (exc.notDirectory) {
        throw makeExc({ notDirectory: true });
      } else {
        throw wrapErr(exc, `Fail to get folder of ${id}`);
      }
    });
  }

  async function getInfo(id: string): Promise<FileInfo | FolderInfo> {
    const stats = await dataFS.stat(id).catch((exc: FileException) => {
      if (exc.notFound) {
        throw makeExc({ notFound: true });
      } else {
        throw wrapErr(exc, `Fail to read content of ${id}`);
      }
    });
    if (stats.isFile || stats.isLink) {
      const xNames = (await dataFS.listXAttrs(id)).filter(
        xName => xName !== ID_ATTR_NAME && xName !== TYPE_ATTR_NAME,
      );
      // A link's own stats describe the link, not what it points at, so size and
      // mtime have to come from the target. Its attributes stay on the link -
      // that is where this store put them - and they are readable even when the
      // target is not: info about an item has to keep working for an attachment
      // whose file is gone, or it could not be taken out of a message. An
      // unreachable target reports as size 0, which is what the UI already
      // treats as a broken attachment.
      const targetStats = stats.isLink
        ? await linkTargetOf(id)
            .then(f => f.stat())
            .catch(() => ({ size: 0, mtime: stats.mtime }))
        : stats;
      const info: FileInfo = {
        id,
        version: stats.version!,
        ctime: stats.ctime!,
        mtime: targetStats.mtime ?? stats.mtime!,
        isFile: true,
        size: targetStats.size ?? 0,
        type: await dataFS.getXAttr(id, TYPE_ATTR_NAME),
      };
      for (const xName of xNames) {
        (info as any)[xName] = await dataFS.getXAttr(id, xName);
      }
      return info;
    } else if (stats.isFolder) {
      const xNames = (await dataFS.listXAttrs(id)).filter(xName => xName !== ID_ATTR_NAME);
      const info: FolderInfo = {
        id,
        version: stats.version!,
        ctime: stats.ctime!,
        mtime: stats.mtime!,
        isFolder: true,
      };
      for (const xName of xNames) {
        (info as any)[xName] = await dataFS.getXAttr(id, xName);
      }
      return info;
    } else {
      throw makeExc({
        notDirectory: true,
        notBlob: true,
        message: `Type of item ${id} is not recognized`,
        cause: stats,
      });
    }
  }

  async function deleteItem(id: string): Promise<void> {
    try {
      await dataFS.deleteFile(id);
      return;
    } catch (exc) {
      if ((exc as FileException).notFound) {
        return;
      }
      if (!(exc as FileException).notFile) {
        throw wrapErr(exc, `Fail to delete item with id ${id}`);
      }
    }
    // A link item. Only the link goes; the file it points at is the user's, and
    // this store never owned it.
    await dataFS.deleteLink(id).catch((exc: FileException) => {
      if (!exc.notFound) {
        throw wrapErr(exc, `Fail to delete link with id ${id}`);
      }
    });
  }

  await setBucket();

  // Operations on the same id are serialized; adding an item makes its own id,
  // so nothing can be chained onto it yet.
  return {
    addBlob,
    addBytes,
    addFile,
    addLink,
    addFolder,
    downloadFile,
    downloadFiles,
    getBlob: id => procs.startOrChain(id, () => getBlob(id)),
    getFile: id => procs.startOrChain(id, () => getFile(id)),
    getFolderRO: id => procs.startOrChain(id, () => getFolderRO(id)),
    getFolderWR: id => procs.startOrChain(id, () => getFolderWR(id)),
    getInfo: id => procs.startOrChain(id, () => getInfo(id)),
    delete: id => procs.startOrChain(id, () => deleteItem(id)),
    updateBlob: (id, blob) => procs.startOrChain(id, () => updateBlob(id, blob)),
    updateInfo: (id, info) => procs.startOrChain(id, () => updateInfo(id, info)),
  };
}

function infoToAttrChanges(info: ItemAttrs): XAttrsChanges {
  let set: XAttrsChanges['set'] = undefined;
  let remove: XAttrsChanges['remove'] = undefined;
  for (const [field, value] of Object.entries(info)) {
    if (value === undefined) {
      if (!remove) {
        remove = [];
      }
      remove.push(field);
    } else {
      if (!set) {
        set = {};
      }
      set[field] = value;
    }
  }
  return { set, remove };
}

function noop() {}

async function newBucketTree(dataFS: WritableFS): Promise<string> {
  let path = generateFastRandomString(FOLDER_NAME_LEN);
  while (await dataFS.checkFolderPresence(path)) {
    path = generateFastRandomString(FOLDER_NAME_LEN);
  }
  for (let i = 1; i < FOLDER_DEPTH; i += 1) {
    path += `/${generateFastRandomString(FOLDER_NAME_LEN)}`;
  }
  await dataFS.makeFolder(path);
  return path;
}

async function newBucketInTree(dataFS: WritableFS, oldBucket: string): Promise<string> {
  let path = oldBucket;
  while (path.length > 0) {
    const sepInd = path.lastIndexOf('/');
    if (sepInd < 0) {
      break;
    }
    path = path.slice(0, sepInd);
    const lst = await dataFS.listFolder(path).catch(noop);
    if (lst && lst.length < BUCKET_TOP_COUNT) {
      return path;
    }
  }
  return newBucketTree(dataFS);
}
