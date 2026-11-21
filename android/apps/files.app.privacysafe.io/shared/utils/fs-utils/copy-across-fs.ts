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
/*
 Copying and moving between two FS objects. The platform moves an entity only
 inside one FS object, while a folder reached through a link is a separate FS
 object (the link's target), even when it lies in the same storage.
*/
import { joinEntityPath } from './entity-name.ts';
import { makeLogger } from '../logger.ts';

const log = makeLogger('FsUtils');

type AnyFS = web3n.files.ReadonlyFS | web3n.files.WritableFS;

export const COPY_INTO_ITSELF_ERROR = 'A folder cannot be copied or moved into itself.';

export function makeFsException(code: string, path: string): web3n.files.FileException {
  return { runtimeException: true, type: 'file', code, path, [code]: true } as web3n.files.FileException;
}

function parentOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx > 0 ? path.slice(0, idx) : '';
}

async function copyXAttrs(srcFs: AnyFS, src: string, dstFs: web3n.files.WritableFS, dst: string): Promise<void> {
  const names = await srcFs.listXAttrs(src).catch(() => [] as string[]);
  if (names.length === 0) {
    return;
  }

  const set: Record<string, unknown> = {};
  for (const name of names) {
    set[name] = await srcFs.getXAttr(src, name);
  }
  // an FS without xattrs (the device) keeps the entity without them
  await dstFs.updateXAttrs(dst, { set }).catch(err => log.error(`Copying xattrs of '${src}' to '${dst}'. `, err));
}

async function isEntityPresent(fs: AnyFS, path: string): Promise<boolean> {
  const checks = await Promise.all([
    fs.checkFolderPresence(path).catch(() => false),
    fs.checkFilePresence(path).catch(() => false),
    fs.checkLinkPresence(path).catch(() => false),
  ]);
  return checks.some(Boolean);
}

async function subtreeHasFolderNamed(fs: AnyFS, root: string, name: string): Promise<boolean> {
  const queue = [root];
  while (queue.length > 0) {
    const folder = queue.shift()!;
    const list = await fs.listFolder(folder).catch(() => [] as web3n.files.ListingEntry[]);
    for (const entry of list) {
      if (!entry.isFolder) {
        continue;
      }
      if (entry.name === name) {
        return true;
      }
      queue.push(joinEntityPath(folder, entry.name));
    }
  }
  return false;
}

/**
 * Throws when the destination of a folder lies inside the source folder. Paths
 * cannot tell it, when the destination is reached through a link: a probe
 * folder is made at the destination and looked for in the source subtree.
 */
export async function assertNotCopiedIntoItself({
  srcFs,
  src,
  dstFs,
  dst,
}: {
  srcFs: AnyFS;
  src: string;
  dstFs: web3n.files.WritableFS;
  dst: string;
}): Promise<void> {
  const probeName = `.link-probe-${crypto.randomUUID()}`;
  const probePath = joinEntityPath(parentOf(dst), probeName);
  await dstFs.makeFolder(probePath, true);
  try {
    if (await subtreeHasFolderNamed(srcFs, src, probeName)) {
      throw new Error(COPY_INTO_ITSELF_ERROR);
    }
  } finally {
    await dstFs.deleteFolder(probePath).catch(err => log.error(`Removing the probe folder '${probePath}'. `, err));
  }
}

async function copyLink(srcFs: AnyFS, src: string, dstFs: web3n.files.WritableFS, dst: string): Promise<boolean> {
  const link = await srcFs.readLink(src).catch(() => undefined);
  const target = link && (await link.target().catch(() => undefined));
  if (!target) {
    // a broken link is not copied, as everywhere in the app
    return false;
  }
  await dstFs.link(dst, target);
  return true;
}

async function copyFolderTree(
  srcFs: AnyFS,
  src: string,
  dstFs: web3n.files.WritableFS,
  dst: string,
  keepXAttrs: boolean,
): Promise<void> {
  await dstFs.makeFolder(dst, true);
  if (keepXAttrs) {
    await copyXAttrs(srcFs, src, dstFs, dst);
  }

  for (const entry of await srcFs.listFolder(src)) {
    const s = joinEntityPath(src, entry.name);
    const d = joinEntityPath(dst, entry.name);
    if (entry.isFolder) {
      await copyFolderTree(srcFs, s, dstFs, d, keepXAttrs);
    } else if (entry.isFile) {
      await dstFs.saveFile(await srcFs.readonlyFile(s), d);
      if (keepXAttrs) {
        await copyXAttrs(srcFs, s, dstFs, d);
      }
    } else if (entry.isLink) {
      await copyLink(srcFs, s, dstFs, d);
    }
  }
}

/**
 * Copies a file, a folder (with its subtree) or a link from one FS object to
 * another. The destination must be free. `keepXAttrs` is for a move: a copy
 * gets no xattrs (ids, favorites), as copies made with saveFile/saveFolder.
 * Returns false for a broken link, which is not copied.
 */
export async function copyEntityAcrossFs({
  srcFs,
  src,
  dstFs,
  dst,
  keepXAttrs = false,
}: {
  srcFs: AnyFS;
  src: string;
  dstFs: web3n.files.WritableFS;
  dst: string;
  keepXAttrs?: boolean;
}): Promise<boolean> {
  const stats = await srcFs.stat(src);
  if (await isEntityPresent(dstFs, dst)) {
    throw makeFsException('alreadyExists', dst);
  }

  if (stats.isLink) {
    return copyLink(srcFs, src, dstFs, dst);
  }

  if (stats.isFile) {
    await dstFs.saveFile(await srcFs.readonlyFile(src), dst);
    if (keepXAttrs) {
      await copyXAttrs(srcFs, src, dstFs, dst);
    }
    return true;
  }

  if (!stats.isFolder) {
    throw makeFsException('notFound', src);
  }

  await assertNotCopiedIntoItself({ srcFs, src, dstFs, dst });
  try {
    await copyFolderTree(srcFs, src, dstFs, dst, keepXAttrs);
  } catch (err) {
    // the partial copy is removed: the source is kept untouched
    await dstFs.deleteFolder(dst, true).catch(() => {});
    throw err;
  }
  return true;
}

/** Moves an entity from one FS object to another: copy, then removal of the source. */
export async function moveEntityAcrossFs({
  srcFs,
  src,
  dstFs,
  dst,
}: {
  srcFs: web3n.files.WritableFS;
  src: string;
  dstFs: web3n.files.WritableFS;
  dst: string;
}): Promise<void> {
  const stats = await srcFs.stat(src);
  const copied = await copyEntityAcrossFs({ srcFs, src, dstFs, dst, keepXAttrs: true });
  if (!copied) {
    throw makeFsException('notFound', src);
  }

  if (stats.isLink) {
    await srcFs.deleteLink(src);
  } else if (stats.isFile) {
    await srcFs.deleteFile(src);
  } else {
    await srcFs.deleteFolder(src, true);
  }
}
