/*
 In-memory implementation of the subset of web3n.files.WritableFS used by the
 storage app. Semantics follow core-3nweb-client-lib/ts-code/lib-client/xsp-fs:
 - paths are normalized with posix.resolve('/', path), so 'a', '/a' and './a'
   point to the same entity;
 - move() creates missing destination folders, throws `alreadyExists` when the
   destination name is taken and `notFound` when the source is missing;
 - deleteFolder() throws `notEmpty` unless removeContent is set.
*/
import { posix } from 'node:path';
import type { FsListItem, ListingEntryExtended, WritableFS } from '../../../shared/types/index.ts';

type NodeType = 'folder' | 'file' | 'link';

interface MemoryNode {
  type: NodeType;
  xattrs: Record<string, unknown>;
  bytes?: Uint8Array;
}

type FileExceptionFlag = 'notFound' | 'alreadyExists' | 'notDirectory' | 'notFile' | 'notEmpty' | 'notLink';

function fileException(flag: FileExceptionFlag, path: string) {
  return { runtimeException: true, type: 'file', code: flag, path, [flag]: true };
}

export function normalize(path: string): string {
  return posix.resolve('/', path).slice(1);
}

function parentOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx > 0 ? path.slice(0, idx) : '';
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export class MemoryFS {
  readonly nodes = new Map<string, MemoryNode>([['', { type: 'folder', xattrs: {} }]]);

  /**
   * Minimal versioned API, present for 'synced' FS only. Every existing entity
   * reports 'unsynced', i.e. it has local changes that are not uploaded yet.
   */
  readonly v?: {
    stat: (path: string) => Promise<web3n.files.Stats>;
    sync: { status: (path: string) => Promise<{ state: web3n.files.SyncState }> };
  };

  constructor(
    readonly name = 'test-fs',
    readonly type: web3n.files.FSType = 'local',
  ) {
    if (type === 'synced') {
      this.v = {
        stat: path => this.stat(path),
        sync: {
          status: async path => {
            this.getNode(path);
            return { state: 'unsynced' };
          },
        },
      };
    }
  }

  readonly writable = true;

  // ---- seeding & inspection helpers (not part of the w3n API) ----

  addFolder(path: string, xattrs: Record<string, unknown> = {}): this {
    const p = normalize(path);
    this.ensureFolder(parentOf(p));
    this.nodes.set(p, { type: 'folder', xattrs: { ...xattrs } });
    return this;
  }

  addFile(path: string, content = '', xattrs: Record<string, unknown> = {}): this {
    const p = normalize(path);
    this.ensureFolder(parentOf(p));
    this.nodes.set(p, { type: 'file', xattrs: { ...xattrs }, bytes: new TextEncoder().encode(content) });
    return this;
  }

  addLink(path: string): this {
    const p = normalize(path);
    this.ensureFolder(parentOf(p));
    this.nodes.set(p, { type: 'link', xattrs: {} });
    return this;
  }

  has(path: string): boolean {
    return this.nodes.has(normalize(path));
  }

  /** Sorted list of all paths, root excluded. */
  paths(): string[] {
    return [...this.nodes.keys()].filter(p => p !== '').sort();
  }

  xattrsOf(path: string): Record<string, unknown> | undefined {
    return this.nodes.get(normalize(path))?.xattrs;
  }

  /** Builds the listing entry the GUI sends to the Deno service. */
  entry(path: string, extra: Partial<ListingEntryExtended> = {}): ListingEntryExtended {
    const p = normalize(path);
    const node = this.nodes.get(p);
    if (!node) {
      throw new Error(`No entity at '${p}' in the test FS`);
    }
    return { id: `id-${p}`, name: nameOf(p), fullPath: p, type: node.type, ...extra };
  }

  asWritableFS(): WritableFS {
    return this as unknown as WritableFS;
  }

  asFsListItem(fsId: string): FsListItem {
    return { fsId, name: this.name, entity: this.asWritableFS() };
  }

  private ensureFolder(path: string): void {
    if (path === '') {
      return;
    }
    const node = this.nodes.get(path);
    if (node) {
      if (node.type !== 'folder') {
        throw fileException('notDirectory', path);
      }
      return;
    }
    this.ensureFolder(parentOf(path));
    this.nodes.set(path, { type: 'folder', xattrs: {} });
  }

  private getNode(path: string): MemoryNode {
    const node = this.nodes.get(normalize(path));
    if (!node) {
      throw fileException('notFound', path);
    }
    return node;
  }

  private childrenOf(path: string): string[] {
    const prefix = path === '' ? '' : `${path}/`;
    return [...this.nodes.keys()].filter(
      p => p !== '' && p !== path && p.startsWith(prefix) && !p.slice(prefix.length).includes('/'),
    );
  }

  private subtreeOf(path: string): string[] {
    return [...this.nodes.keys()].filter(p => p === path || p.startsWith(`${path}/`));
  }

  // ---- web3n.files.WritableFS subset ----

  async listFolder(path: string): Promise<web3n.files.ListingEntry[]> {
    const p = normalize(path);
    const node = this.getNode(p);
    if (node.type !== 'folder') {
      throw fileException('notDirectory', path);
    }
    return this.childrenOf(p).map(child => {
      const { type } = this.nodes.get(child)!;
      return {
        name: nameOf(child),
        isFolder: type === 'folder' || undefined,
        isFile: type === 'file' || undefined,
        isLink: type === 'link' || undefined,
      };
    });
  }

  async checkFolderPresence(path: string): Promise<boolean> {
    return this.nodes.get(normalize(path))?.type === 'folder';
  }

  async checkFilePresence(path: string): Promise<boolean> {
    return this.nodes.get(normalize(path))?.type === 'file';
  }

  async checkLinkPresence(path: string): Promise<boolean> {
    return this.nodes.get(normalize(path))?.type === 'link';
  }

  async stat(path: string): Promise<web3n.files.Stats> {
    const node = this.getNode(path);
    return {
      isFolder: node.type === 'folder' || undefined,
      isFile: node.type === 'file' || undefined,
      isLink: node.type === 'link' || undefined,
      writable: true,
      size: node.bytes?.length,
    } as web3n.files.Stats;
  }

  async makeFolder(path: string, exclusive = false): Promise<void> {
    const p = normalize(path);
    if (exclusive && this.nodes.has(p)) {
      throw fileException('alreadyExists', path);
    }
    this.ensureFolder(p);
  }

  async move(initPath: string, newPath: string): Promise<void> {
    const src = normalize(initPath);
    const dst = normalize(newPath);
    if (src === '' || dst === '') {
      throw new Error('Bad path: it points to filesystem root');
    }
    if (!this.nodes.has(src)) {
      throw fileException('notFound', initPath);
    }
    if (this.nodes.has(dst)) {
      throw fileException('alreadyExists', newPath);
    }
    if (dst.startsWith(`${src}/`)) {
      throw new Error(`Cannot move '${src}' into itself`);
    }
    this.ensureFolder(parentOf(dst));
    for (const p of this.subtreeOf(src)) {
      const node = this.nodes.get(p)!;
      this.nodes.delete(p);
      this.nodes.set(dst + p.slice(src.length), node);
    }
  }

  async deleteFile(path: string): Promise<void> {
    const node = this.getNode(path);
    if (node.type !== 'file') {
      throw fileException('notFile', path);
    }
    this.nodes.delete(normalize(path));
  }

  async deleteLink(path: string): Promise<void> {
    const node = this.getNode(path);
    if (node.type !== 'link') {
      throw fileException('notLink', path);
    }
    this.nodes.delete(normalize(path));
  }

  async deleteFolder(path: string, removeContent = false): Promise<void> {
    const p = normalize(path);
    if (p === '') {
      throw new Error('Cannot remove root folder');
    }
    const node = this.getNode(p);
    if (node.type !== 'folder') {
      throw fileException('notDirectory', path);
    }
    if (!removeContent && this.childrenOf(p).length > 0) {
      throw fileException('notEmpty', path);
    }
    for (const sub of this.subtreeOf(p)) {
      this.nodes.delete(sub);
    }
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const p = normalize(path);
    this.ensureFolder(parentOf(p));
    const existing = this.nodes.get(p);
    if (existing && existing.type !== 'file') {
      throw fileException('notFile', path);
    }
    this.nodes.set(p, { type: 'file', xattrs: existing?.xattrs ?? {}, bytes });
  }

  /** The file is created at once; written bytes become its content on done(). */
  async getByteSink(path: string, flags: web3n.files.FileFlags = {}): Promise<web3n.files.FileByteSink> {
    const p = normalize(path);
    const existing = this.nodes.get(p);
    if (existing && flags.exclusive) {
      throw fileException('alreadyExists', path);
    }
    if (existing && existing.type !== 'file') {
      throw fileException('notFile', path);
    }
    this.ensureFolder(parentOf(p));
    const node: MemoryNode = existing ?? { type: 'file', xattrs: {}, bytes: new Uint8Array() };
    this.nodes.set(p, node);

    let content = flags.truncate === false && node.bytes ? Array.from(node.bytes) : [];
    let isDone = false;
    return {
      getSize: async () => content.length,
      splice: async (pos: number, del: number, bytes?: Uint8Array) => {
        if (isDone) {
          throw new Error('Sink is done');
        }
        content = [...content.slice(0, pos), ...(bytes ?? []), ...content.slice(pos + del)];
      },
      truncate: async (size: number) => {
        content = content.slice(0, size);
      },
      showLayout: async () => ({ sections: [] }) as unknown as web3n.files.FileLayout,
      done: async (err?: unknown) => {
        isDone = true;
        if (!err) {
          node.bytes = Uint8Array.from(content);
        }
      },
    };
  }

  async readBytes(path: string): Promise<Uint8Array | undefined> {
    const node = this.getNode(path);
    if (node.type !== 'file') {
      throw fileException('notFile', path);
    }
    return node.bytes;
  }

  async readLink(path: string): Promise<web3n.files.SymLink> {
    const node = this.getNode(path);
    if (node.type !== 'link') {
      throw fileException('notLink', path);
    }
    throw new Error('Links are not supported by MemoryFS');
  }

  async readonlySubRoot(folder: string): Promise<web3n.files.ReadonlyFS> {
    const node = this.getNode(folder);
    if (node.type !== 'folder') {
      throw fileException('notDirectory', folder);
    }
    throw new Error('Sub roots are not supported by MemoryFS');
  }

  async updateXAttrs(path: string, changes: web3n.files.XAttrsChanges): Promise<void> {
    const node = this.getNode(path);
    Object.assign(node.xattrs, changes.set ?? {});
    for (const name of changes.remove ?? []) {
      delete node.xattrs[name];
    }
  }

  async listXAttrs(path: string): Promise<string[]> {
    return Object.keys(this.getNode(path).xattrs);
  }

  async getXAttr(path: string, xaName: string): Promise<unknown> {
    return this.getNode(path).xattrs[xaName];
  }
}
