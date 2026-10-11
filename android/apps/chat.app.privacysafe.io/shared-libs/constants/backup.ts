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

/** Written into the metadata, so an archive of another app can be told apart. */
export const APP_DOMAIN = 'chat.app.privacysafe.io';

/** Always stored unencrypted, so an archive can be identified without a key. */
export const METADATA_FILE_NAME = 'chat_app_privacysafe_io.json';

/** The single entry an encrypted archive carries besides the metadata file. */
export const PAYLOAD_FILE_NAME = 'payload.zip.enc';

export const CHATS_FILE_NAME = 'chats.json';
export const MESSAGES_FILE_NAME = 'messages.json';
export const TOMBSTONES_FILE_NAME = 'tombstones.json';

/** Prefix of the entries carrying attachment bytes. */
export const ATTACHMENTS_FOLDER = 'attachments';

/**
 * Layout of the archive, not the version of the app. Bump it when the set of
 * entries or the shape of a record changes in a way this build could not read
 * back. See checkBackupFormatCompatibility.
 */
export const BACKUP_FORMAT_VERSION = 1;

/**
 * The most an archive may weigh.
 *
 * Not a guard on IPC here, unlike in the mail app: this app's manifest gives
 * the GUI both `shell.fileDialog` and `storage`, so the bytes of an attachment
 * never cross a process boundary - the window reads them out of the file store
 * itself. The limit stays for the other reason, which no layering can remove:
 * `zipSync` and AES-GCM both need the whole buffer in memory at once. An
 * oversized backup is refused with a reason the user can act on - take it
 * without attachments.
 */
export const BACKUP_MAX_BYTES = 1024 * 1024 * 1024;

/**
 * How much of a restore snapshot goes into one phantom.
 *
 * A snapshot carries records, never attachment bytes (see the carrier rule in
 * doc/08-backup-and-restore.md), so what grows with the size of the history is
 * the NUMBER of deliveries and not the size of one message.
 */
export const RESTORE_SNAPSHOT_CHUNK_BYTES = 192 * 1024;

/**
 * Upper bound on files taken from one folder attachment.
 *
 * A folder attachment is archived as a tree, and the tree is somebody's own
 * directory: nothing about it is bounded. Past this the rest of the folder is
 * left out with the `folder-partial` reason, which the user is told about, so
 * that one deep directory cannot turn a backup into an unbounded walk.
 */
export const MAX_FILES_PER_FOLDER_ATTACHMENT = 2000;
