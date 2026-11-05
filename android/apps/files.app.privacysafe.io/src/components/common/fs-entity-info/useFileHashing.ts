/*
 Copyright (C) 2025 3NSoft Inc.

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
import { computed, type ComputedRef, Ref, ref, shallowRef } from 'vue';
import { createSHA256, createSHA512 } from 'hash-wasm';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import type { ListingEntryExtended } from '@shared/types';
import { useFsStore } from '@/store';

const bufferLen = 512 * 1024;

type ReadonlyFile = web3n.files.ReadonlyFile;
type FileByteSource = web3n.files.FileByteSource;

export function useFileHashing(
  fsId: ComputedRef<string>,
  path: ComputedRef<string>,
  fileStats: Ref<Nullable<ListingEntryExtended>>,
) {
  const { getFs } = useFsStore();

  const sha256hex = ref<Nullable<string>>(null);
  const calculating256 = ref(false);
  const sha256progress = ref(0);

  const sha512hex = ref<Nullable<string>>(null);
  const calculating512 = ref(false);
  const sha512progress = ref(0);

  /*
   The file whose content is hashed: the entity itself, or the target of a link
   to a file. Its size comes from the opened file, not from the entity: the
   stats of a link are not the stats of its target.

   Hashes are not kept in xattrs: in a synced storage a write of xattrs is a new
   version of the file and its upload. Through the target of a file link such a
   write even breaks the upload of the file (П20, core 0.53.11: the target is a
   separate node). The file is opened only for reading.
  */
  const file = shallowRef<Nullable<ReadonlyFile>>(null);
  const contentSize = ref<Nullable<number>>(null);

  const canHash = computed(() => typeof contentSize.value === 'number');

  /**
   * Feeds the whole content to the hasher. Returns false when stopped before
   * the end: a digest of partial content must never be shown.
   */
  async function readAndHashProcess(
    content: FileByteSource,
    hasher: { update: (chunk: Uint8Array) => void },
    reportProgress: (bytesDone: number) => void,
    shouldStop: () => boolean,
  ): Promise<boolean> {
    const totalSize = await content.getSize();
    let bytesRead = 0;
    let bytesHashed = 0;
    let chunk: Uint8Array | undefined = undefined;

    function hashChunkAndReport() {
      // note that on the first cycle there is no chunk, hence we check
      if (chunk) {
        hasher.update(chunk);
        bytesHashed += chunk.length;
        chunk = undefined;
        reportProgress(bytesHashed);
      }
    }

    while (bytesRead < totalSize) {
      if (shouldStop()) {
        return false;
      }

      // start reading, but don't wait here
      const reading = content.readNext(bufferLen);

      // this process hashes, while core gets new chunk
      hashChunkAndReport();

      chunk = await reading;
      if (chunk) {
        bytesRead += chunk.length;
      } else {
        throw new Error(`Unexpect end of file`);
      }
    }

    if (shouldStop()) {
      return false;
    }

    // hash the last chunk
    hashChunkAndReport();
    return true;
  }

  /**
   * Every hashing run gets an id; stopHashingProcess() and a new run make the
   * previous id stale. A stale run does not update the UI.
   */
  let currentRunId = 0;

  async function openFile(fsIdValue: string, pathValue: string): Promise<Nullable<ReadonlyFile>> {
    const fs = getFs(fsIdValue);
    if (fileStats.value?.type !== 'link-file') {
      return fs.readonlyFile(pathValue);
    }

    const link = await fs.readLink(pathValue);
    // target() resolves the link to either a file or a folder
    const target = await link.target();
    return link.isFile ? (target as ReadonlyFile) : null;
  }

  async function loadFile(): Promise<Nullable<ReadonlyFile>> {
    if (!file.value) {
      const requestedFsId = fsId.value;
      const requestedPath = path.value;
      const loadedFile = await openFile(requestedFsId, requestedPath);
      const stats = loadedFile ? await loadedFile.stat() : undefined;
      // the panel may have switched to another entity while the file was opening
      if (requestedFsId === fsId.value && requestedPath === path.value && loadedFile && stats) {
        file.value = loadedFile;
        contentSize.value = stats.size ?? null;
      }
    }
    return file.value;
  }

  async function runHash({
    createHasher,
    hex,
    calculating,
    progress,
    targetFile,
    contentLen,
    isCurrentRun,
  }: {
    createHasher: typeof createSHA256;
    hex: Ref<Nullable<string>>;
    calculating: Ref<boolean>;
    progress: Ref<number>;
    targetFile: ReadonlyFile;
    contentLen: number;
    isCurrentRun: () => boolean;
  }): Promise<boolean> {
    try {
      calculating.value = true;
      const hasher = await createHasher();
      hasher.init();

      const content = await targetFile.getByteSource();
      const completed = await readAndHashProcess(
        content,
        hasher,
        bytesDone => {
          if (isCurrentRun()) {
            progress.value = contentLen ? Math.floor((bytesDone / contentLen) * 100) : 100;
          }
        },
        () => !isCurrentRun(),
      );

      if (!completed || !isCurrentRun()) {
        return false;
      }

      hex.value = hasher.digest('hex');
      return true;
    } finally {
      if (isCurrentRun()) {
        calculating.value = false;
      }
    }
  }

  async function calculateHash() {
    const runId = ++currentRunId;
    const isCurrentRun = () => runId === currentRunId;

    const targetFile = await loadFile();
    if (!targetFile || !canHash.value || !isCurrentRun()) {
      return;
    }

    const common = { targetFile, contentLen: contentSize.value!, isCurrentRun };

    const sha256done = await runHash({
      createHasher: createSHA256,
      hex: sha256hex,
      calculating: calculating256,
      progress: sha256progress,
      ...common,
    });
    if (!sha256done) {
      return;
    }

    await runHash({
      createHasher: createSHA512,
      hex: sha512hex,
      calculating: calculating512,
      progress: sha512progress,
      ...common,
    });
  }

  function stopHashingProcess() {
    currentRunId += 1;
    sha256hex.value = null;
    sha512hex.value = null;
    calculating256.value = false;
    calculating512.value = false;
    sha256progress.value = 0;
    sha512progress.value = 0;
    file.value = null;
    contentSize.value = null;
  }

  /** Opens the file to hash: the button is shown when the file can be read. */
  async function loadHashing() {
    await loadFile();
  }

  return {
    canHash,
    sha256hex,
    calculating256,
    sha256progress,
    sha512hex,
    calculating512,
    sha512progress,
    calculateHash,
    loadHashing,
    stopHashingProcess,
  };
}
