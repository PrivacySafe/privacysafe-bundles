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

/**
 * True when the local and the remote versions of a conflicting entity hold the
 * same: no differences in the folder entries (or in the file content) and in
 * xattrs; ctime/mtime do not count. The platform's diff compares the current
 * and the remote versions directly, the synced one only tells which side made
 * a change. Then "Keep Local" would only upload the same data as a new version,
 * while "Keep Cloud" resolves the conflict without an upload.
 *
 * Such conflicts come from uploads that were applied by the server but recorded
 * as failed by the client (platform reports П15, П18).
 */
export function areConflictVersionsSame(
  diff: web3n.files.FolderDiff | web3n.files.FileDiff | undefined,
  type: 'folder' | 'file',
): boolean {
  if (!diff || diff.isRemoteRemoved) {
    return false;
  }
  if (diff.xattrs && Object.keys(diff.xattrs).length > 0) {
    return false;
  }
  if (type === 'file') {
    return (diff as web3n.files.FileDiff).areContentsSame === true;
  }
  const { added, removed, renamed, rekeyed, nameOverlaps } = diff as web3n.files.FolderDiff;
  const isEmpty = (list?: unknown[]) => !list || list.length === 0;
  return (
    isEmpty(added?.inLocal) &&
    isEmpty(added?.inRemote) &&
    isEmpty(removed?.inLocal) &&
    isEmpty(removed?.inRemote) &&
    isEmpty(renamed) &&
    isEmpty(rekeyed) &&
    isEmpty(nameOverlaps)
  );
}

/** An error of an action in the conflict dialog with its own message. */
export class ResolveActionError extends Error {
  constructor(
    readonly noticeKey: string,
    readonly cause?: unknown,
  ) {
    super(noticeKey);
  }
}
