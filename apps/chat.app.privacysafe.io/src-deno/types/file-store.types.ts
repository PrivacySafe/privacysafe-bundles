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

export interface FileStoreService {
  saveFile(data: ArrayBuffer, fileName?: string): Promise<string>;
  /**
   * Copies the entity into the store, so that the stored item stops depending
   * on the file the user gave. Throws when the copy fails: an id that points at
   * nothing is worse than no id at all.
   */
  saveCopy(entity: web3n.files.ReadonlyFile | web3n.files.ReadonlyFS): Promise<string>;
  /**
   * Takes a reference to an entity that stays where it is. The stored item is
   * only as good as its target, which the user is free to move or delete.
   */
  saveLink(entity: web3n.files.ReadonlyFile | web3n.files.ReadonlyFS): Promise<string>;
  /**
   * The reverse of listFolderEntity: a tree of bytes becomes a NEW local id.
   *
   * The price of archiving folder attachments as trees. saveFile() takes an
   * ArrayBuffer and nothing else, so there is no way to put a folder back
   * through it - and flattening the tree would restore a bundle of files rather
   * than the folder that was attached.
   */
  saveFolderOfBytes(entries: { path: string; bytes: Uint8Array }[], folderName?: string): Promise<string>;
  getLink(entityId: string): Promise<web3n.files.SymLink | null | undefined>;
  getFile(entityId: string): Promise<web3n.files.File | web3n.files.FS | null | undefined>;
  /**
   * What lies under an id, WITHOUT following a link - which is what tells an
   * attachment stored as a copy from one stored as a reference to the user's own
   * file (above ATTACHMENT_COPY_THRESHOLD). getFile() cannot answer this: it
   * follows the link and hands back the target.
   *
   * Not getLink() either: that returns undefined both for a copy and for any
   * failure, and logs an `error` for every copy - which on a backup, where this
   * is asked about every attachment there is, is a stream of false errors.
   */
  statEntity(
    entityId: string,
  ): Promise<{ isLink: boolean; isFile: boolean; isFolder: boolean; size?: number } | undefined>;
  /** Recursive listing of a stored folder: relative path -> size. */
  listFolderEntity(entityId: string): Promise<{ path: string; size: number }[] | undefined>;
  /**
   * Removes a stored item, whichever kind it is: a link, a copied file or a
   * copied folder. Deleting a link never touches the file it points at.
   */
  deleteEntity(entityId: string): Promise<void>;
}
