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
import { ATTACHMENT_READ_CHUNK_SIZE } from '@shared/constants/attachment-limits';

export interface ReadProgress {
  /** Bytes read so far. */
  done: number;
  /** Size of the file, or 0 when it could not be established. */
  total: number;
}

export type OnReadProgress = (progress: ReadProgress) => void;

/**
 * Reads a file a chunk at a time, reporting how far it has got.
 *
 * An attachment of an incoming message is not on this device until something
 * reads it, so this read can take as long as a download - and a spinner that
 * says nothing about progress is indistinguishable from a hung window. Reading
 * in chunks is what makes the wait legible, and interruptible.
 *
 * @returns the file's bytes, or undefined if the read was aborted.
 */
export async function readFileWithProgress(
  file: web3n.files.ReadonlyFile,
  onProgress?: OnReadProgress,
  signal?: AbortSignal,
): Promise<Uint8Array | undefined> {
  const src = await file.getByteSource();
  const total = await src.getSize().catch(() => 0);

  const chunks: Uint8Array[] = [];
  let done = 0;
  onProgress?.({ done, total });

  while (!signal?.aborted) {
    const chunk = await src.readNext(ATTACHMENT_READ_CHUNK_SIZE);
    if (!chunk || chunk.length === 0) {
      break;
    }
    chunks.push(chunk);
    done += chunk.length;
    onProgress?.({ done, total });
    // A chunk shorter than asked for means the end of the file, so there is no
    // point in one more round trip just to be told there is nothing left.
    if (chunk.length < ATTACHMENT_READ_CHUNK_SIZE) {
      break;
    }
  }

  if (signal?.aborted) {
    return undefined;
  }
  return joinChunks(chunks, done);
}

/**
 * Reads a file in chunks, handing each one over as it arrives.
 *
 * For a consumer that can do something with a part of the file - a media element
 * fed through MediaSource - rather than needing all of it first.
 *
 * @returns true if the whole file was read, false if the read was aborted.
 */
export async function pipeFileInChunks(
  file: web3n.files.ReadonlyFile,
  onChunk: (chunk: Uint8Array) => Promise<void>,
  onProgress?: OnReadProgress,
  signal?: AbortSignal,
): Promise<boolean> {
  const src = await file.getByteSource();
  const total = await src.getSize().catch(() => 0);

  let done = 0;
  onProgress?.({ done, total });

  while (!signal?.aborted) {
    const chunk = await src.readNext(ATTACHMENT_READ_CHUNK_SIZE);
    if (!chunk || chunk.length === 0) {
      break;
    }
    await onChunk(chunk);
    done += chunk.length;
    onProgress?.({ done, total });
    if (chunk.length < ATTACHMENT_READ_CHUNK_SIZE) {
      break;
    }
  }

  return !signal?.aborted;
}

function joinChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  if (chunks.length === 1) {
    return chunks[0];
  }
  const all = new Uint8Array(totalLength);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return all;
}
