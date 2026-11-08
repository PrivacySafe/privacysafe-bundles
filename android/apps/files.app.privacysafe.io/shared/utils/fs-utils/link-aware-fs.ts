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
 Paths through links to folders.

 The app shows "logical" paths: what the user went through, e.g.
 'Docs/LinkToWork/Project1', where 'LinkToWork' is a link to a folder. The
 platform does not follow links inside a path (a link in the middle gives
 `notDirectory`), and the target of a folder link is a separate FS object with
 its root in the target folder; the target's path in the root FS is unknown.

 The resolver turns a logical folder path into the FS object and the path in
 it. The link-aware FS takes logical paths in all methods and runs each call on
 the resolved FS object. For an entity the parent folder is resolved and the
 last name is kept, so a link itself is renamed, moved or removed, not its
 target. Listing a folder path resolves it entirely, so a folder link is listed
 as its target folder.
*/
import { formatPath } from '../various.ts';
import { makeLogger } from '../logger.ts';
import { isSameOrInside, joinEntityPath } from './entity-name.ts';
import {
  assertNotCopiedIntoItself,
  copyEntityAcrossFs,
  makeFsException,
  moveEntityAcrossFs,
} from './copy-across-fs.ts';

type WritableFS = web3n.files.WritableFS;
type AnyFS = web3n.files.ReadonlyFS | WritableFS;
type AnyFn = (...args: unknown[]) => unknown;

// TEMPORARY (debugging of sync through links): lines tagged 🔗 are at the info level.
const log = makeLogger('LinkAwareFS');

/** Links in one path; a deeper chain is treated as a loop. */
export const MAX_LINK_HOPS = 16;
/** A cached link older than this is checked to be still in place before use. */
export const LINK_HOP_REVALIDATE_MS = 5000;

/**
 * `<folder>/.` is the folder itself with links followed, as in POSIX: for a
 * link to a folder it is the root of the link's target, while `<folder>` is the
 * link. The sync queue uses it for the target root of a folder link.
 */
export const FOLDER_ITSELF_SUFFIX = '/.';

/** The path of the folder itself, links followed: see FOLDER_ITSELF_SUFFIX. */
export function toFolderItselfPath(path: string): string {
  const p = formatPath(path || '');
  return p ? `${p}${FOLDER_ITSELF_SUFFIX}` : '';
}

/** Splits off the FOLDER_ITSELF_SUFFIX: the folder path and whether it was there. */
export function parseFolderItselfPath(path: string): { path: string; isFolderItself: boolean } {
  const p = formatPath(path || '');
  if (p === '.') {
    return { path: '', isFolderItself: true };
  }
  return p.endsWith(FOLDER_ITSELF_SUFFIX)
    ? { path: p.slice(0, -FOLDER_ITSELF_SUFFIX.length), isFolderItself: true }
    : { path: p, isFolderItself: false };
}

export interface FsLocationSegment {
  name: string;
  isLink: boolean;
}

export interface FsLocation {
  /** The FS object holding the folder; a ReadonlyFS when `writable` is false. */
  fs: WritableFS;
  /** The folder's path in `fs`; '' for the root of a link's target. */
  path: string;
  /** False when a link on the way gives readonly access. */
  writable: boolean;
  /** True when the path goes through at least one link. */
  hasHops: boolean;
  segments: FsLocationSegment[];
}

interface HopEntry {
  fs: AnyFS;
  writable: boolean;
  segments: FsLocationSegment[];
  parentFs: AnyFS;
  linkPath: string;
  checkedAt: number;
}

function splitPath(path: string): string[] {
  return formatPath(path || '')
    .split('/')
    .filter(Boolean);
}

function splitParent(path: string): { parent: string; name: string } {
  const parts = splitPath(path);
  return { parent: parts.slice(0, -1).join('/'), name: parts.at(-1) ?? '' };
}

/** Own and inherited members: platform FS objects keep methods as own fields, test ones in classes. */
function memberNames(obj: object): string[] {
  const names = new Set<string>();
  let o: object | null = obj;
  while (o && o !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(o)) {
      if (name !== 'constructor') {
        names.add(name);
      }
    }
    o = Object.getPrototypeOf(o);
  }
  return [...names];
}

function hasFlag(err: unknown, flag: string): boolean {
  return !!err && typeof err === 'object' && (err as Record<string, unknown>)[flag] === true;
}

function readonlyTargetError(path: string): web3n.files.FileException {
  return { ...makeFsException('notPermitted', path), readonlyLinkTarget: true } as web3n.files.FileException;
}

export class FsLinkResolver {
  private readonly hops = new Map<string, HopEntry>();

  constructor(
    private readonly root: AnyFS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** True when a cached link is at `path` or on the way to it. */
  hasCachedHop(path: string): boolean {
    const p = formatPath(path || '');
    if (!p) {
      return false;
    }
    for (const key of this.hops.keys()) {
      if (isSameOrInside(p, key)) {
        return true;
      }
    }
    return false;
  }

  /** Forgets the links at `path` and inside it ('' forgets all). */
  invalidate(path = ''): void {
    const p = formatPath(path);
    for (const key of [...this.hops.keys()]) {
      if (isSameOrInside(key, p)) {
        this.hops.delete(key);
      }
    }
  }

  /** Forgets the links on the way to `path`. */
  forgetHopsOf(path: string): void {
    const p = formatPath(path);
    for (const key of [...this.hops.keys()]) {
      if (isSameOrInside(p, key)) {
        this.hops.delete(key);
      }
    }
  }

  private async cachedStart(
    parts: string[],
  ): Promise<{ index: number; fs: AnyFS; writable: boolean; segments: FsLocationSegment[] } | undefined> {
    for (let i = parts.length; i > 0; i--) {
      const key = parts.slice(0, i).join('/');
      const entry = this.hops.get(key);
      if (!entry) {
        continue;
      }
      if (this.now() - entry.checkedAt > LINK_HOP_REVALIDATE_MS) {
        const isInPlace = await entry.parentFs.checkLinkPresence(entry.linkPath).catch(() => false);
        if (!isInPlace) {
          this.invalidate(key);
          continue;
        }
        entry.checkedAt = this.now();
      }
      return { index: i, fs: entry.fs, writable: entry.writable, segments: [...entry.segments] };
    }
    return undefined;
  }

  /**
   * Resolves a logical folder path. With `allowMissingTail` the missing end of
   * the path is kept in the returned path, for calls that create folders.
   */
  async resolveFolder(path: string, { allowMissingTail = false } = {}): Promise<FsLocation> {
    const parts = splitPath(path);
    const start = await this.cachedStart(parts);
    let fs: AnyFS = start?.fs ?? this.root;
    let writable = start ? start.writable : this.root.writable !== false;
    const segments: FsLocationSegment[] = start?.segments ?? [];
    let index = start?.index ?? 0;

    const rest = parts.slice(index);
    if (rest.length === 0 || (await fs.checkFolderPresence(rest.join('/')).catch(() => false))) {
      segments.push(...rest.map(name => ({ name, isLink: false })));
      return makeLocation(fs, rest.join('/'), writable, segments);
    }

    let inner: string[] = [];
    let hopsCount = segments.filter(s => s.isLink).length;
    for (; index < parts.length; index++) {
      const name = parts[index];
      const candidate = [...inner, name].join('/');
      const logical = parts.slice(0, index + 1).join('/');

      if (await fs.checkFolderPresence(candidate).catch(() => false)) {
        inner.push(name);
        segments.push({ name, isLink: false });
        continue;
      }

      if (!(await fs.checkLinkPresence(candidate).catch(() => false))) {
        if (await fs.checkFilePresence(candidate).catch(() => false)) {
          throw makeFsException('notDirectory', logical);
        }
        if (!allowMissingTail) {
          throw makeFsException('notFound', logical);
        }
        const tail = parts.slice(index);
        segments.push(...tail.map(n => ({ name: n, isLink: false })));
        return makeLocation(fs, [...inner, ...tail].join('/'), writable, segments);
      }

      hopsCount += 1;
      if (hopsCount > MAX_LINK_HOPS) {
        throw new Error(`Too many links in the path '${formatPath(path)}'.`);
      }

      const link = await fs.readLink(candidate);
      if (!link.isFolder) {
        throw makeFsException('notDirectory', logical);
      }
      const target = (await link.target()) as AnyFS;
      const parentFs = fs;
      writable = writable && !link.readonly && target.writable !== false;
      fs = target;
      inner = [];
      segments.push({ name, isLink: true });
      log.info(`🔗 link '${logical}' -> target '${target.name}' (${target.type}, writable: ${writable})`);
      this.hops.set(logical, {
        fs: target,
        writable,
        segments: [...segments],
        parentFs,
        linkPath: candidate,
        checkedAt: this.now(),
      });
    }

    return makeLocation(fs, inner.join('/'), writable, segments);
  }
}

function makeLocation(fs: AnyFS, path: string, writable: boolean, segments: FsLocationSegment[]): FsLocation {
  return { fs: fs as WritableFS, path, writable, hasHops: segments.some(s => s.isLink), segments };
}

export interface LinkAwareFS extends WritableFS {
  /** The FS object itself; it is what platform APIs (mounts, links) take. */
  readonly raw: WritableFS;
  /** Resolves a logical folder path, links included. */
  resolveFolder(path: string): Promise<FsLocation>;
  /** True when the entity is reached through a link, i.e. its path is not a path in the root FS. */
  isReachedThroughLinks(path: string): Promise<boolean>;
  /** Forgets the cached links at `path` and inside it. */
  invalidateLinks(path?: string): void;
}

export function isLinkAwareFs(fs: unknown): fs is LinkAwareFS {
  return (
    !!fs &&
    typeof fs === 'object' &&
    typeof (fs as LinkAwareFS).resolveFolder === 'function' &&
    !!(fs as LinkAwareFS).raw
  );
}

export function unwrapLinkAwareFs<T>(fs: T): T {
  return isLinkAwareFs(fs) ? (fs.raw as T) : fs;
}

type Mode = 'entity' | 'folder';

interface MethodSpec {
  mode: Mode;
  write?: boolean;
}

const FS_METHODS: Record<string, MethodSpec> = {
  stat: { mode: 'entity' },
  getXAttr: { mode: 'entity' },
  listXAttrs: { mode: 'entity' },
  readLink: { mode: 'entity' },
  readTxtFile: { mode: 'entity' },
  readJSONFile: { mode: 'entity' },
  readBytes: { mode: 'entity' },
  getByteSource: { mode: 'entity' },
  readonlyFile: { mode: 'entity' },
  readonlySubRoot: { mode: 'folder' },
  listFolder: { mode: 'folder' },
  select: { mode: 'folder' },
  updateXAttrs: { mode: 'entity', write: true },
  makeFolder: { mode: 'entity', write: true },
  deleteFile: { mode: 'entity', write: true },
  writeJSONFile: { mode: 'entity', write: true },
  writeTxtFile: { mode: 'entity', write: true },
  writeBytes: { mode: 'entity', write: true },
  getByteSink: { mode: 'entity', write: true },
  writableFile: { mode: 'entity', write: true },
  writableSubRoot: { mode: 'folder', write: true },
};

const V_METHODS: Record<string, MethodSpec> = {
  stat: { mode: 'entity' },
  getXAttr: { mode: 'entity' },
  listXAttrs: { mode: 'entity' },
  listFolder: { mode: 'folder' },
  readTxtFile: { mode: 'entity' },
  readJSONFile: { mode: 'entity' },
  readBytes: { mode: 'entity' },
  getByteSource: { mode: 'entity' },
  listVersions: { mode: 'entity' },
  updateXAttrs: { mode: 'entity', write: true },
  writeJSONFile: { mode: 'entity', write: true },
  writeTxtFile: { mode: 'entity', write: true },
  writeBytes: { mode: 'entity', write: true },
  getByteSink: { mode: 'entity', write: true },
  archiveCurrent: { mode: 'entity', write: true },
};

const SYNC_METHODS: Record<string, MethodSpec> = {
  status: { mode: 'entity' },
  isRemoteVersionOnDisk: { mode: 'entity' },
  startDownload: { mode: 'entity' },
  adoptRemote: { mode: 'entity', write: true },
  diffCurrentAndRemoteFolderVersions: { mode: 'folder' },
  diffCurrentAndRemoteFileVersions: { mode: 'entity' },
  statRemoteItem: { mode: 'folder' },
  listRemoteFolderItem: { mode: 'folder' },
  getRemoteFileItem: { mode: 'folder' },
  getRemoteFolderItem: { mode: 'folder' },
  startUpload: { mode: 'entity', write: true },
  upload: { mode: 'entity', write: true },
  adoptRemoteFolderItem: { mode: 'folder', write: true },
  absorbRemoteFolderChanges: { mode: 'folder', write: true },
};

/** Methods handled separately below, or passed to the root as they are. */
const SPECIAL_FS_METHODS = new Set([
  'checkFolderPresence',
  'checkFilePresence',
  'checkLinkPresence',
  'deleteFolder',
  'deleteLink',
  'link',
  'move',
  'copyFile',
  'copyFolder',
  'saveFile',
  'saveFolder',
  'watchFolder',
  'watchFile',
  'watchTree',
]);

/**
 * Wraps an FS so that its methods take logical paths, i.e. paths that may go
 * through links to folders. Paths without links cost no extra calls: a call is
 * made with the path as it is, and only `notDirectory` from a link on the way
 * makes it resolved and repeated.
 */
export function makeLinkAwareFs(root: WritableFS): LinkAwareFS {
  if (isLinkAwareFs(root)) {
    return root;
  }

  const resolver = new FsLinkResolver(root);
  /** FS objects of folders reached through links: copying them may go into themselves. */
  const subRootsBehindLinks = new WeakSet<object>();

  async function locate(path: string, mode: Mode): Promise<FsLocation> {
    const p = formatPath(path || '');
    if (mode === 'folder') {
      return resolver.resolveFolder(p, { allowMissingTail: true });
    }
    const { parent, name } = splitParent(p);
    if (!parent) {
      return makeLocation(root, p, root.writable, []);
    }
    const loc = await resolver.resolveFolder(parent, { allowMissingTail: true });
    return { ...loc, path: joinEntityPath(loc.path, name) };
  }

  async function runResolved<T>(
    p: string,
    spec: MethodSpec,
    call: (fs: AnyFS, path: string, loc: FsLocation) => Promise<T>,
    canRetry: boolean,
  ): Promise<T> {
    const loc = await locate(p, spec.mode);
    if (loc.hasHops && spec.write) {
      log.info(`🔗 write '${p}' (${spec.mode}) -> '${loc.path}' in '${loc.fs.name}'`);
    }
    if (spec.write && loc.hasHops && !loc.writable) {
      throw readonlyTargetError(p);
    }
    try {
      return await call(loc.fs, loc.path, loc);
    } catch (err) {
      // a cached link may be outdated: the call is repeated with links read anew
      if (canRetry && loc.hasHops && (hasFlag(err, 'notFound') || hasFlag(err, 'notDirectory'))) {
        resolver.forgetHopsOf(p);
        return runResolved(p, spec, call, false);
      }
      throw err;
    }
  }

  async function run<T>(
    path: string,
    spec: MethodSpec,
    call: (fs: AnyFS, path: string, loc?: FsLocation) => Promise<T>,
  ): Promise<T> {
    const { path: p, isFolderItself } = parseFolderItselfPath(path);
    if (isFolderItself) {
      // the platform takes 'link/.' for the link itself: the folder is resolved here, with no
      // first try as it is, and the call goes to the folder (the target root for a link)
      return p ? runResolved(p, { ...spec, mode: 'folder' }, call, true) : call(root, '');
    }
    const resolvedPart = spec.mode === 'folder' ? p : splitParent(p).parent;
    if (!resolvedPart) {
      return call(root, p);
    }
    if (!resolver.hasCachedHop(resolvedPart)) {
      try {
        return await call(root, p);
      } catch (err) {
        if (!hasFlag(err, 'notDirectory')) {
          throw err;
        }
      }
    }
    return runResolved(p, spec, call, true);
  }

  function wrapApi(
    getApi: (fs: AnyFS) => Record<string, unknown> | undefined,
    rootApi: Record<string, unknown>,
    specs: Record<string, MethodSpec>,
    apiName: string,
  ): Record<string, unknown> {
    const wrapped: Record<string, unknown> = {};
    for (const name of memberNames(rootApi)) {
      const value = rootApi[name];
      if (typeof value !== 'function') {
        wrapped[name] = value;
        continue;
      }
      const spec = specs[name];
      if (!spec) {
        // methods without a path, e.g. whenConnected()
        wrapped[name] = (...args: unknown[]) => (value as AnyFn).apply(rootApi, args);
        continue;
      }
      wrapped[name] = (path: string, ...args: unknown[]) =>
        run(path, spec, async (fs, p, loc) => {
          const api = getApi(fs);
          const fn = api?.[name];
          if (typeof fn !== 'function') {
            throw new Error(`'${apiName}.${name}' is not available for '${p}'.`);
          }
          const result = await (fn as AnyFn).apply(api, [p, ...args]);
          if (loc?.hasHops && (name === 'readonlySubRoot' || name === 'writableSubRoot') && result) {
            subRootsBehindLinks.add(result as object);
          }
          return result;
        });
    }
    return wrapped;
  }

  async function checkPresence(
    kind: 'checkFilePresence' | 'checkLinkPresence',
    path: string,
    throwIfMissing?: boolean,
  ): Promise<boolean> {
    const p = formatPath(path || '');
    const { parent } = splitParent(p);
    // the device FS throws notFound from checkLinkPresence for a missing path (device-fs.ts
    // checkPresence), while a check without throwIfMissing has to answer false
    const safe = (check: Promise<boolean>) => (throwIfMissing ? check : check.catch(() => false));
    if (!parent) {
      return safe(root[kind](p, throwIfMissing));
    }
    // presence checks give false instead of `notDirectory`, so a link on the way is looked for
    if (!resolver.hasCachedHop(parent) && (await root[kind](p).catch(() => false))) {
      return true;
    }
    const loc = await locate(p, 'entity').catch(() => undefined);
    if (!loc?.hasHops) {
      return safe(root[kind](p, throwIfMissing));
    }
    return safe(loc.fs[kind](loc.path, throwIfMissing));
  }

  async function checkFolderPresence(path: string, throwIfMissing?: boolean): Promise<boolean> {
    const p = formatPath(path || '');
    if (!p) {
      return true;
    }
    if (!resolver.hasCachedHop(p) && (await root.checkFolderPresence(p).catch(() => false))) {
      return true;
    }
    try {
      // a link to a folder is a folder here, as with `test -d` on a symlink
      await resolver.resolveFolder(p);
      return true;
    } catch (err) {
      if (throwIfMissing) {
        throw err;
      }
      return false;
    }
  }

  async function twoPaths(
    src: string,
    dst: string,
    sameFs: (fs: WritableFS, s: string, d: string) => Promise<void>,
    acrossFs: (srcLoc: FsLocation, dstLoc: FsLocation) => Promise<void>,
    { srcIsWritten = false } = {},
  ): Promise<void> {
    const s = formatPath(src || '');
    const d = formatPath(dst || '');
    const viaCache = resolver.hasCachedHop(splitParent(s).parent) || resolver.hasCachedHop(splitParent(d).parent);
    if (!viaCache) {
      try {
        return await sameFs(root, s, d);
      } catch (err) {
        if (!hasFlag(err, 'notDirectory')) {
          throw err;
        }
      }
    }

    const [srcLoc, dstLoc] = await Promise.all([locate(s, 'entity'), locate(d, 'entity')]);
    if (dstLoc.hasHops && !dstLoc.writable) {
      throw readonlyTargetError(d);
    }
    if (srcIsWritten && srcLoc.hasHops && !srcLoc.writable) {
      throw readonlyTargetError(s);
    }
    if (srcLoc.fs === dstLoc.fs) {
      return sameFs(srcLoc.fs, srcLoc.path, dstLoc.path);
    }
    return acrossFs(srcLoc, dstLoc);
  }

  function watch(
    method: 'watchFolder' | 'watchFile' | 'watchTree',
    path: string,
    subscribe: (fs: AnyFS, p: string, obs: web3n.Observer<unknown>) => () => void,
    observer: web3n.Observer<unknown>,
  ): () => void {
    const p = formatPath(path || '');
    let unsubscribe: (() => void) | undefined;
    let isClosed = false;

    locate(p, method === 'watchFile' ? 'entity' : 'folder').then(
      loc => {
        if (isClosed) {
          return;
        }
        if (!loc.hasHops) {
          unsubscribe = subscribe(root, p, observer);
          return;
        }
        // events come with paths in the target FS; they are turned back into logical ones
        const toLogical = (eventPath: string) => {
          const ep = formatPath(eventPath || '');
          if (ep === loc.path) {
            return p;
          }
          if (loc.path === '') {
            return joinEntityPath(p, ep);
          }
          return ep.startsWith(`${loc.path}/`) ? joinEntityPath(p, ep.slice(loc.path.length + 1)) : ep;
        };
        unsubscribe = subscribe(loc.fs, loc.path, {
          next: ev => {
            const event = ev as { path?: string };
            observer.next?.(typeof event?.path === 'string' ? { ...event, path: toLogical(event.path) } : ev);
          },
          error: err => observer.error?.(err),
          complete: () => observer.complete?.(),
        });
      },
      err => observer.error?.(err),
    );

    return () => {
      isClosed = true;
      unsubscribe?.();
    };
  }

  const fsSpecialMethods: Record<string, AnyFn> = {
    checkFolderPresence: (path, throwIfMissing) => checkFolderPresence(path as string, throwIfMissing as boolean),
    checkFilePresence: (path, throwIfMissing) =>
      checkPresence('checkFilePresence', path as string, throwIfMissing as boolean),
    checkLinkPresence: (path, throwIfMissing) =>
      checkPresence('checkLinkPresence', path as string, throwIfMissing as boolean),

    deleteFolder: async (path, removeContent) => {
      await run(path as string, { mode: 'entity', write: true }, (fs, p) =>
        (fs as WritableFS).deleteFolder(p, removeContent as boolean),
      );
      resolver.invalidate(path as string);
    },

    deleteLink: async path => {
      await run(path as string, { mode: 'entity', write: true }, (fs, p) => (fs as WritableFS).deleteLink(p));
      resolver.invalidate(path as string);
    },

    link: async (path, target) => {
      await run(path as string, { mode: 'entity', write: true }, (fs, p) =>
        (fs as WritableFS).link(p, unwrapLinkAwareFs(target) as web3n.files.File | web3n.files.FS),
      );
      resolver.invalidate(path as string);
    },

    move: async (src, dst) => {
      await twoPaths(
        src as string,
        dst as string,
        (fs, s, d) => fs.move(s, d),
        (srcLoc, dstLoc) =>
          moveEntityAcrossFs({ srcFs: srcLoc.fs, src: srcLoc.path, dstFs: dstLoc.fs, dst: dstLoc.path }),
        { srcIsWritten: true },
      );
      resolver.invalidate(src as string);
      resolver.invalidate(dst as string);
    },

    copyFile: (src, dst, overwrite) =>
      twoPaths(
        src as string,
        dst as string,
        (fs, s, d) => fs.copyFile(s, d, overwrite as boolean),
        async (srcLoc, dstLoc) => {
          if (overwrite && (await dstLoc.fs.checkFilePresence(dstLoc.path).catch(() => false))) {
            await dstLoc.fs.deleteFile(dstLoc.path);
          }
          await copyEntityAcrossFs({ srcFs: srcLoc.fs, src: srcLoc.path, dstFs: dstLoc.fs, dst: dstLoc.path });
        },
      ),

    copyFolder: (src, dst, mergeAndOverwrite) =>
      twoPaths(
        src as string,
        dst as string,
        (fs, s, d) => fs.copyFolder(s, d, mergeAndOverwrite as boolean),
        async (srcLoc, dstLoc) => {
          if (mergeAndOverwrite) {
            await assertNotCopiedIntoItself({
              srcFs: srcLoc.fs,
              src: srcLoc.path,
              dstFs: dstLoc.fs,
              dst: dstLoc.path,
            });
            const folder = await srcLoc.fs.readonlySubRoot(srcLoc.path);
            await dstLoc.fs.saveFolder(folder, dstLoc.path, true);
            return;
          }
          await copyEntityAcrossFs({ srcFs: srcLoc.fs, src: srcLoc.path, dstFs: dstLoc.fs, dst: dstLoc.path });
        },
      ),

    saveFile: (file, dst, overwrite) =>
      run(dst as string, { mode: 'entity', write: true }, (fs, p) =>
        (fs as WritableFS).saveFile(file as web3n.files.File, p, overwrite as boolean),
      ),

    saveFolder: (folder, dst, mergeAndOverwrite) => {
      const srcFolder = unwrapLinkAwareFs(folder) as web3n.files.FS;
      return run(dst as string, { mode: 'entity', write: true }, async (fs, p, loc) => {
        if (loc?.hasHops || subRootsBehindLinks.has(srcFolder)) {
          await assertNotCopiedIntoItself({ srcFs: srcFolder, src: '', dstFs: fs as WritableFS, dst: p });
        }
        return (fs as WritableFS).saveFolder(srcFolder, p, mergeAndOverwrite as boolean);
      });
    },

    watchFolder: (path, observer) =>
      watch(
        'watchFolder',
        path as string,
        (fs, p, obs) => fs.watchFolder(p, obs as Parameters<AnyFS['watchFolder']>[1]),
        observer as web3n.Observer<unknown>,
      ),
    watchFile: (path, observer) =>
      watch(
        'watchFile',
        path as string,
        (fs, p, obs) => fs.watchFile(p, obs as Parameters<AnyFS['watchFile']>[1]),
        observer as web3n.Observer<unknown>,
      ),
    watchTree: (path, depth, observer) =>
      watch(
        'watchTree',
        path as string,
        (fs, p, obs) => fs.watchTree(p, depth as number | undefined, obs as Parameters<AnyFS['watchTree']>[2]),
        observer as web3n.Observer<unknown>,
      ),
  };

  const rootRecord = root as unknown as Record<string, unknown>;
  const wrapped = wrapApi(fs => fs as unknown as Record<string, unknown>, rootRecord, FS_METHODS, 'fs');

  for (const name of SPECIAL_FS_METHODS) {
    if (typeof rootRecord[name] === 'function') {
      wrapped[name] = fsSpecialMethods[name];
    }
  }

  if (root.v) {
    const rootV = root.v as unknown as Record<string, unknown>;
    const v = wrapApi(fs => fs.v as unknown as Record<string, unknown> | undefined, rootV, V_METHODS, 'fs.v');
    if (root.v.sync) {
      v.sync = wrapApi(
        fs => fs.v?.sync as unknown as Record<string, unknown> | undefined,
        root.v.sync as unknown as Record<string, unknown>,
        SYNC_METHODS,
        'fs.v.sync',
      );
    }
    wrapped.v = v;
  }

  Object.assign(wrapped, {
    raw: root,
    resolveFolder: (path: string) => resolver.resolveFolder(path),
    isReachedThroughLinks: async (path: string) => {
      const { parent } = splitParent(path);
      if (!parent) {
        return false;
      }
      const loc = await resolver.resolveFolder(parent, { allowMissingTail: true }).catch(() => undefined);
      return !!loc?.hasHops;
    },
    invalidateLinks: (path?: string) => resolver.invalidate(path),
  });

  return wrapped as unknown as LinkAwareFS;
}
