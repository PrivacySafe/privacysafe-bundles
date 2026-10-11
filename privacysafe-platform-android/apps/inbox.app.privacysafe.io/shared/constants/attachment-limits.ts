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
 * The biggest attachment this app is willing to take.
 *
 * It is also what the background component asks its own server to accept from
 * anonymous senders, so that what we send and what we can be sent agree. The
 * recipient's server has the final say: delivery checks the message against
 * `preFlight()`'s number and fails with `msgTooBig` if it does not fit.
 */
export const MAX_ATTACHMENT_SIZE = 200 * 1024 * 1024;

/**
 * Attachments up to this size are copied into the app's file store, so that a
 * draft survives a restart and a sent message keeps a downloadable copy.
 *
 * Above it the file is left where it is and only referenced, then read straight
 * from there when the message is packed: ASMail reads attachments lazily, in
 * chunks, so a large file never has to be duplicated. The cost is that such an
 * attachment is only as good as the user's own file, which they can move,
 * rename or delete.
 */
export const ATTACHMENT_COPY_THRESHOLD = 32 * 1024 * 1024;

/**
 * How much is read from a file per call when reading it with progress.
 *
 * Every read is an IPC round trip, so a small chunk would turn one read into
 * hundreds of calls and end up slower than the single readBytes() it replaces.
 * This is a compromise between that and how often progress can be reported.
 */
export const ATTACHMENT_READ_CHUNK_SIZE = 1024 * 1024;

/**
 * Attachments up to this size get their preview made as soon as the message is
 * opened. Bigger ones show a file icon until the user asks for the preview.
 *
 * Making a preview needs the whole file, and an incoming attachment is not on
 * this device until something reads it - so without a limit, opening a message
 * with ten photos pulls all ten from the server. Chosen to cover an ordinary
 * photo while leaving out video and anything unusually large.
 */
export const THUMBNAIL_AUTO_PREVIEW_LIMIT = 10 * 1024 * 1024;

/**
 * Previews longer than this are not kept in the database.
 *
 * A preview is a data URL, and the database file is rewritten whole on every
 * save, so cached previews add to the cost of every write. An outsized one is
 * still shown - it just has to be made again next time.
 */
export const THUMBNAIL_CACHE_MAX_CHARS = 32 * 1024;
