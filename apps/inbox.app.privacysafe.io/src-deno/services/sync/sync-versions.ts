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
import type { DBProvider } from '../../dataset/index.ts';
import type { SyncAspect, SyncEntityType, SyncToken } from '../../types/sync-types.ts';
import { makeLogger } from '../../../shared/utils/logger.ts';

const log = makeLogger('SyncVersions');

/**
 * The slice of the database these rules actually touch.
 *
 * Narrower than DBProvider on purpose. It says what the rules depend on, and it
 * lets a spec hand them a plain in-memory object instead of casting one to
 * DBProvider - a cast that switches off the very check that would catch the
 * object drifting from the interface.
 */
export type SyncVersionStore = Pick<
  DBProvider,
  'getSyncVersion' | 'setSyncVersion' | 'deleteSyncVersionsOf'
>;

/**
 * Compares two ordering tokens, giving a total order: by ts, and by deviceId
 * when the stamps are equal. A total order is what makes every device pick the
 * same winner for concurrent changes - a comparison that left ties unresolved
 * would let devices diverge.
 *
 * An absent stored token means nothing has been applied yet, so anything wins.
 * An *equal* token loses, and that is what makes re-sending a phantom from the
 * journal harmless.
 */
export function isNewerToken(incoming: SyncToken, stored: SyncToken | undefined): boolean {
  if (!stored) {
    return true;
  }
  if (incoming.ts !== stored.ts) {
    return incoming.ts > stored.ts;
  }
  return incoming.deviceId > stored.deviceId;
}

/**
 * Applies a change only if its token is newer than the one already recorded for
 * this aspect, and records the token when it does. The single place where the
 * last-write-wins rule lives.
 */
export async function applyIfNewer(
  {
    db,
    entityType,
    entityId,
    aspect,
    token,
  }: {
    db: SyncVersionStore;
    entityType: SyncEntityType;
    entityId: string;
    aspect: SyncAspect;
    token: SyncToken;
  },
  apply: () => Promise<void>,
): Promise<boolean> {
  const stored = db.getSyncVersion(entityType, entityId, aspect);
  if (!isNewerToken(token, stored)) {
    log.debug(
      `Skipping stale sync of ${aspect} for ${entityType} ${entityId}: `
        + `incoming ${token.ts}/${token.deviceId}, stored ${stored?.ts}/${stored?.deviceId}`,
    );
    return false;
  }

  await apply();
  await db.setSyncVersion(entityType, entityId, aspect, token);
  return true;
}

/**
 * Whether an entity has a tombstone newer than the given token, i.e. it was
 * deleted after the change this token belongs to was made. This is what keeps a
 * phantom arriving after a deletion from resurrecting the entity.
 */
export function isDeletedLaterThan(
  db: SyncVersionStore,
  entityType: SyncEntityType,
  entityId: string,
  token: SyncToken,
): boolean {
  const tombstone = db.getSyncVersion(entityType, entityId, 'deleted');
  return !!tombstone && !isNewerToken(token, tombstone);
}

/**
 * Records a deletion: a tombstone that outlives the entity, plus removal of the
 * entity's other aspect versions.
 */
export async function recordDeletion(
  db: SyncVersionStore,
  entityType: SyncEntityType,
  entityId: string,
  token: SyncToken,
): Promise<void> {
  await db.deleteSyncVersionsOf(entityType, entityId);
  await db.setSyncVersion(entityType, entityId, 'deleted', {
    ...token,
    tombstonedAt: Date.now(),
  });
}
