export const GET_STATE_QUERY = 'SELECT * FROM app';

export const UPSERT_STATE_QUERY =
  'INSERT INTO app (id, state) VALUES ($id, $state) ON CONFLICT(id) DO UPDATE SET id=$id, state=$state';

export const INSERT_FOLDER_QUERY =
  'INSERT INTO folders (id, name, icon, iconColor, position, path, isSystem) VALUES ($id, $name, $icon, $iconColor, $position, $path, $isSystem)';

export const UPSERT_FOLDER_QUERY =
  'INSERT INTO folders (id, name, icon, iconColor, position, path, isSystem) VALUES ($id, $name, $icon, $iconColor, $position, $path, $isSystem) ON CONFLICT(id) DO UPDATE SET name=$name, icon=$icon, iconColor=$iconColor, position=$position, path=$path, isSystem=$isSystem';

export const GET_FOLDER_LIST_QUERY = 'SELECT * FROM folders';

export const DELETE_FOLDER_BY_ID_QUERY = 'DELETE FROM folders WHERE id=$id';

export const GET_MESSAGES_QUERY = 'SELECT * FROM messages';

export const GET_MESSAGE_QUERY_BY_ID = 'SELECT * FROM messages WHERE msgId=$msgId';

export const GET_MESSAGES_QUERY_BY_THREAD_ID = 'SELECT * FROM messages WHERE threadId=$threadId';

export const INSERT_MESSAGE_QUERY =
  'INSERT INTO messages (msgId, threadId, msgType, cTime, deliveryTS, subject, plainTxtBody, htmlTxtBody, jsonBody, recipients, sender, status, statusDescription, attachmentsInfo, mailFolder, originDeviceId) VALUES ($msgId, $threadId, $msgType, $cTime, $deliveryTS, $subject, $plainTxtBody, $htmlTxtBody, $jsonBody, $recipients, $sender, $status, $statusDescription, $attachmentsInfo, $mailFolder, $originDeviceId)';

// statusDescription is in the VALUES list, and not only in DO UPDATE SET: an
// insert that goes through this statement used to drop the description of a
// delivery error outright.
export const UPSERT_MESSAGE_QUERY =
  'INSERT INTO messages (msgId, threadId, msgType, cTime, deliveryTS, subject, plainTxtBody, htmlTxtBody, jsonBody, recipients, sender, status, statusDescription, attachmentsInfo, mailFolder, originDeviceId) VALUES ($msgId, $threadId, $msgType, $cTime, $deliveryTS, $subject, $plainTxtBody, $htmlTxtBody, $jsonBody, $recipients, $sender, $status, $statusDescription, $attachmentsInfo, $mailFolder, $originDeviceId) ON CONFLICT(msgId) DO UPDATE SET msgId=$msgId, threadId=$threadId, msgType=$msgType, cTime=$cTime, deliveryTS=$deliveryTS, subject=$subject, plainTxtBody=$plainTxtBody, htmlTxtBody=$htmlTxtBody, jsonBody=$jsonBody, recipients=$recipients, sender=$sender, status=$status, statusDescription=$statusDescription, attachmentsInfo=$attachmentsInfo, mailFolder=$mailFolder, originDeviceId=$originDeviceId';

export const DELETE_MESSAGE_BY_ID_QUERY = `DELETE
 FROM messages
 WHERE msgId = $msgId`;

export const DELETE_THREAD_QUERY = `DELETE
  FROM messages
  WHERE threadId = $threadId`;

export const GET_THUMBNAILS_BY_MSG_QUERY = 'SELECT * FROM thumbnails WHERE msgId=$msgId';

export const UPSERT_THUMBNAIL_QUERY =
  'INSERT INTO thumbnails (msgId, fileName, dataUrl) VALUES ($msgId, $fileName, $dataUrl) ON CONFLICT(msgId, fileName) DO UPDATE SET dataUrl=$dataUrl';

export const DELETE_THUMBNAILS_BY_MSG_QUERY = 'DELETE FROM thumbnails WHERE msgId=$msgId';

export const DELETE_THUMBNAILS_BY_THREAD_QUERY = `DELETE
  FROM thumbnails
  WHERE msgId IN (SELECT msgId FROM messages WHERE threadId = $threadId)`;

// =============================================================================
// Synchronization between the user's own devices
// =============================================================================

export const GET_SYNC_DEVICE_QUERY = 'SELECT * FROM sync_device WHERE id=$id';

export const UPSERT_SYNC_DEVICE_QUERY = `INSERT INTO sync_device (
    id, appDeviceId, lastSyncClockTs, otherDeviceSeenId, otherDeviceSeenAt
  ) VALUES ($id, $appDeviceId, $lastSyncClockTs, $otherDeviceSeenId, $otherDeviceSeenAt)
  ON CONFLICT(id) DO UPDATE SET
    appDeviceId=$appDeviceId,
    lastSyncClockTs=$lastSyncClockTs,
    otherDeviceSeenId=$otherDeviceSeenId,
    otherDeviceSeenAt=$otherDeviceSeenAt`;

export const GET_SYNC_VERSION_QUERY = `SELECT ts, deviceId, tombstonedAt
  FROM sync_versions
  WHERE entityType=$entityType AND entityId=$entityId AND aspect=$aspect`;

/**
 * The whole table, read in one go for a backup.
 *
 * Ordered so that an archive taken twice over an unchanged mailbox is
 * byte-identical in this part: sqlite is free to answer an unordered SELECT in
 * any order, and a diff of two archives is the cheapest way to see that a
 * backup lost something.
 */
export const GET_ALL_SYNC_VERSIONS_QUERY = `SELECT entityType, entityId, aspect, ts, deviceId, tombstonedAt
  FROM sync_versions
  ORDER BY entityType ASC, entityId ASC, aspect ASC`;

export const UPSERT_SYNC_VERSION_QUERY = `INSERT OR REPLACE INTO sync_versions (
    entityType, entityId, aspect, ts, deviceId, tombstonedAt
  ) VALUES ($entityType, $entityId, $aspect, $ts, $deviceId, $tombstonedAt)`;

/**
 * Drops an entity's versions except its tombstones: the whole point of a
 * tombstone is to outlive the entity and keep a late phantom from resurrecting
 * it.
 */
export const DELETE_SYNC_VERSIONS_OF_QUERY = `DELETE FROM sync_versions
  WHERE entityType=$entityType AND entityId=$entityId AND tombstonedAt IS NULL`;

export const GC_SYNC_VERSIONS_QUERY = `DELETE FROM sync_versions
  WHERE tombstonedAt IS NOT NULL AND tombstonedAt < $expiresBefore`;

export const INSERT_PENDING_SYNC_MSG_QUERY = `INSERT INTO pending_sync_msgs (
    entityType, entityId, aspect, entityCount, ts, payload, attempts
  ) VALUES ($entityType, $entityId, $aspect, $entityCount, $ts, $payload, 0)`;

export const GET_PENDING_SYNC_MSGS_QUERY = `SELECT id, entityType, entityId, aspect, entityCount, ts, payload, attempts
  FROM pending_sync_msgs
  ORDER BY ts ASC, id ASC`;

export const COUNT_PENDING_SYNC_MSGS_QUERY = 'SELECT COUNT(*) AS num FROM pending_sync_msgs';

export const DELETE_PENDING_SYNC_MSG_QUERY = 'DELETE FROM pending_sync_msgs WHERE id=$id';

export const BUMP_PENDING_SYNC_MSG_ATTEMPTS_QUERY =
  'UPDATE pending_sync_msgs SET attempts = attempts + 1 WHERE id=$id';

export const GET_PENDING_SYNC_MSG_ATTEMPTS_QUERY =
  'SELECT attempts FROM pending_sync_msgs WHERE id=$id';

export const DROP_EXPIRED_PENDING_SYNC_MSGS_QUERY =
  'DELETE FROM pending_sync_msgs WHERE ts < $expiresBefore';

export const INSERT_ORPHANED_SYNC_QUERY = `INSERT INTO orphaned_syncs (
    targetMsgId, ts, rawPayload, bufferedAt
  ) VALUES ($targetMsgId, $ts, $rawPayload, $bufferedAt)`;

export const GET_ORPHANED_SYNCS_FOR_QUERY = `SELECT id, targetMsgId, ts, rawPayload, bufferedAt
  FROM orphaned_syncs
  WHERE targetMsgId=$targetMsgId
  ORDER BY ts ASC, id ASC`;

export const DELETE_ORPHANED_SYNC_QUERY = 'DELETE FROM orphaned_syncs WHERE id=$id';

export const COUNT_ORPHANED_SYNCS_QUERY = 'SELECT COUNT(*) AS num FROM orphaned_syncs';

export const GC_ORPHANED_SYNCS_QUERY = 'DELETE FROM orphaned_syncs WHERE bufferedAt < $expiresBefore';

/**
 * INSERT OR IGNORE, and not an upsert: a repeated scheduling of the same
 * phantom (replayed by a catch-up scan before its term is up) must not *extend*
 * its life in the inbox. The term runs from the first handling.
 */
export const SCHEDULE_INBOX_REMOVAL_QUERY = `INSERT OR IGNORE INTO pending_inbox_removals (msgId, removeAfter)
  VALUES ($msgId, $removeAfter)`;

export const GET_EXPIRED_INBOX_REMOVALS_QUERY =
  'SELECT msgId FROM pending_inbox_removals WHERE removeAfter < $now';

export const DELETE_INBOX_REMOVAL_QUERY = 'DELETE FROM pending_inbox_removals WHERE msgId=$msgId';

export const COUNT_PENDING_INBOX_REMOVALS_QUERY =
  'SELECT COUNT(*) AS num FROM pending_inbox_removals';

export const GET_CONTACT_BLACKLIST_QUERY = 'SELECT address FROM contact_blacklist';

export const CLEAR_CONTACT_BLACKLIST_QUERY = 'DELETE FROM contact_blacklist';

export const INSERT_CONTACT_BLACKLIST_QUERY =
  'INSERT OR IGNORE INTO contact_blacklist (address) VALUES ($address)';
