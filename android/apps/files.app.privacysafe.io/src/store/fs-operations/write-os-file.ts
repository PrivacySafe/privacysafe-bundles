/*
 Copyright (C) 2024-2025 3NSoft Inc.

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
// bigger chunks mean fewer calls to the platform; 1 MiB keeps memory use low
export const UPLOAD_CHUNK_SIZE = 1024 * 1024;

/**
 * Streams a file from the OS into a new file of the given FS, without holding
 * the whole content in memory. The target must not exist yet (it is created
 * exclusively). On any error the partly written file is discarded by the sink.
 */
export async function writeOsFile({
  fs,
  path,
  file,
  onProgress,
  chunkSize = UPLOAD_CHUNK_SIZE,
}: {
  fs: web3n.files.WritableFS;
  path: string;
  file: Blob;
  onProgress?: (bytesWritten: number, totalBytes: number) => void;
  chunkSize?: number;
}): Promise<void> {
  const sink = await fs.getByteSink(path, { create: true, exclusive: true });
  let position = 0;

  try {
    while (position < file.size) {
      const chunk = new Uint8Array(await file.slice(position, position + chunkSize).arrayBuffer());
      if (chunk.length === 0) {
        throw new Error(`Unexpected end of the file at ${position} of ${file.size} bytes`);
      }
      await sink.splice(position, 0, chunk);
      position += chunk.length;
      onProgress?.(position, file.size);
    }
  } catch (err) {
    await sink.done(err);
    // the file was created here exclusively: do not leave a partly written one
    await fs.deleteFile(path).catch(() => {});
    throw err;
  }

  await sink.done();
  if (file.size === 0) {
    onProgress?.(0, 0);
  }
}
