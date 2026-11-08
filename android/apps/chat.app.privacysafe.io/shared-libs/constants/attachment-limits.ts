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
 * recipient's server has the final say: delivery fails with `msgTooBig` when
 * the message does not fit what that server allows.
 */
export const MAX_ATTACHMENT_SIZE = 200 * 1024 * 1024;

/**
 * Attachments up to this size are copied into the app's file store when the
 * message is sent, and the copy is what goes into the message.
 *
 * Two things follow from the copy. The sender's own message keeps a readable
 * attachment even after they move, rename or delete the file they attached -
 * without it the message record holds a link to nothing. And delivery, which
 * reads attachments lazily and long after the message was queued, reads the
 * copy instead of a file the user is free to change under it.
 *
 * Above this size the file is left where it is and only referenced: duplicating
 * a big file costs more than the risk it removes. Such an attachment is only as
 * good as the user's own file.
 */
export const ATTACHMENT_COPY_THRESHOLD = 20 * 1024 * 1024;

/**
 * How much is read from a file per call when reading it with progress.
 *
 * Every read is an IPC round trip, so a small chunk would turn one read into
 * hundreds of calls and end up slower than the single readBytes() it replaces.
 * This is a compromise between that and how often progress can be reported.
 */
export const ATTACHMENT_READ_CHUNK_SIZE = 1024 * 1024;

/**
 * The biggest audio file that is played progressively, through MediaSource.
 *
 * A SourceBuffer holds a bounded amount of data, and the bound is not ours to
 * choose: Chromium fixes it at ~12 MiB for an audio stream and ~150 MiB for a
 * video one - **per track, not per file**. Past that its garbage collector
 * frees room by dropping what lies behind the playhead, and MSE offers no way
 * to put those bytes back without an index from time to byte offset, which
 * ordinary containers do not carry. So a file that does not fit in one piece
 * cannot be streamed and then rewound - see doc/09-attachment-streaming.md.
 *
 * For audio the file IS the track, so this bound is exact rather than guessed.
 * The margin below 12 MiB covers Chromium accounting for demuxed buffers, which
 * carry per-frame metadata on top of the bytes we append.
 */
export const STREAMABLE_AUDIO_MAX_SIZE = 8 * 1024 * 1024;

/**
 * The same for video, and unlike the audio one this is a guess.
 *
 * The video track's own ceiling is ~150 MiB, but the audio track inside a webm
 * has its own 12 MiB regardless of how big the file is, and what share of the
 * file that track takes cannot be known in advance - a screencast of a mostly
 * still picture can be more sound than image. This covers the usual proportion
 * with room to spare; a webm in a chat is normally far smaller.
 */
export const STREAMABLE_VIDEO_MAX_SIZE = 64 * 1024 * 1024;

/**
 * Attachments up to this size get their preview made as soon as the message
 * shows up. Bigger ones show a file icon until the user asks for the preview.
 *
 * Making a preview needs the whole file, and an incoming attachment is not on
 * this device until something reads it - so without a limit, opening a chat
 * with ten photos in a message pulls all ten from the server. Chosen to cover
 * an ordinary photo while leaving out video and anything unusually large.
 */
export const THUMBNAIL_AUTO_PREVIEW_LIMIT = 10 * 1024 * 1024;

/**
 * Previews longer than this are not kept in the database.
 *
 * A preview is a data URL, and the database file is rewritten whole on every
 * save, so cached previews add to the cost of every write. An outsized one is
 * still shown - it just has to be made again next time.
 *
 * Twice the limit INBOX uses, and deliberately: resizeImage hands back PNG
 * (canvas.toDataURL() with no arguments), and a PNG of a photograph is a good
 * deal heavier than the JPEG it would be. If previews turn out to miss the
 * cache en masse, the answer is to encode them as JPEG, not to raise this.
 */
export const THUMBNAIL_CACHE_MAX_CHARS = 64 * 1024;
