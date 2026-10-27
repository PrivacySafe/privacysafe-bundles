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

const HASHES_XATTR_NAME = 'cached-hashes';
const SHA256_ALG = 'SHA-256';
const SHA512_ALG = 'SHA-512';

const bufferLen = 512 * 1024;

interface CachedFileContentHashes {
  contentMTime: number;
  contentLen: number;
  hashes: { [alg: string]: string };
}

type ReadonlyFile = web3n.files.ReadonlyFile;
type WritableFile = web3n.files.WritableFile;
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

  const file = shallowRef<Nullable<WritableFile | undefined>>(null);
  const fileSize = computed(() => fileStats.value?.size ?? 0);
  const fileMTime = computed(() => fileStats.value?.mtime?.valueOf() ?? 0);

  async function readCachedHashes(file: ReadonlyFile): Promise<CachedFileContentHashes | undefined> {
    try {
      const hashes = !fsId.value.includes('device')
        ? ((await file.getXAttr(HASHES_XATTR_NAME).catch(() => undefined)) as CachedFileContentHashes | undefined)
        : undefined;

      if (!hashes || typeof hashes !== 'object') {
        return;
      }
      const { mtime, size } = await file.stat();
      if (hashes.contentMTime === mtime?.valueOf() && hashes.contentLen === size) {
        return hashes;
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      /* empty */
    }
  }

  async function cacheHashInXAttrOf(
    file: WritableFile,
    contentMTime: number,
    contentLen: number,
    alg: string,
    hashInHex: string,
  ): Promise<void> {
    try {
      const { mtime, size } = await file.stat();
      if (contentMTime !== mtime?.valueOf() || contentLen !== size) {
        throw new Error(`Given content mtime and size don't correspond to current file's values.`);
      }
      let hashes = await readCachedHashes(file);
      if (hashes && hashes.contentMTime === mtime.valueOf() && hashes.contentLen === size) {
        hashes.hashes[alg] = hashInHex;
      } else {
        hashes = { contentMTime, contentLen, hashes: { [alg]: hashInHex } };
      }
      await file.updateXAttrs({ set: { [HASHES_XATTR_NAME]: hashes } });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      /* empty */
    }
  }

  /**
   * Feeds the whole content to the hasher. Returns false when stopped before
   * the end: a digest of partial content must never be shown or cached.
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
   * previous id stale. A stale run neither updates the UI nor writes the cache.
   */
  let currentRunId = 0;

  async function loadFile(): Promise<Nullable<WritableFile | undefined>> {
    if (!file.value) {
      const requestedFsId = fsId.value;
      const requestedPath = path.value;
      const fs = getFs(requestedFsId);
      const loadedFile = await fs.writableFile(requestedPath);
      // the panel may have switched to another entity while the file was opening
      if (requestedFsId === fsId.value && requestedPath === path.value) {
        file.value = loadedFile;
      }
    }
    return file.value;
  }

  async function runHash({
    alg,
    createHasher,
    hex,
    calculating,
    progress,
    targetFile,
    contentMTime,
    contentLen,
    isCurrentRun,
  }: {
    alg: string;
    createHasher: typeof createSHA256;
    hex: Ref<Nullable<string>>;
    calculating: Ref<boolean>;
    progress: Ref<number>;
    targetFile: WritableFile;
    contentMTime: number;
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

      const hashInHex = hasher.digest('hex');
      hex.value = hashInHex;
      // cache into the file that was hashed, with its own mtime and size
      await cacheHashInXAttrOf(targetFile, contentMTime, contentLen, alg, hashInHex);
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
    if (!targetFile || !isCurrentRun()) {
      return;
    }

    const common = {
      targetFile,
      contentMTime: fileMTime.value,
      contentLen: fileSize.value,
      isCurrentRun,
    };

    const sha256done = await runHash({
      alg: SHA256_ALG,
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
      alg: SHA512_ALG,
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
  }

  async function loadCachedHashes(targetFile: WritableFile, isCurrentRun: () => boolean) {
    try {
      const cached = await readCachedHashes(targetFile);
      if (!cached || !isCurrentRun()) {
        return;
      }
      if (cached.hashes[SHA256_ALG]) {
        sha256hex.value = cached.hashes[SHA256_ALG];
      }
      if (cached.hashes[SHA512_ALG]) {
        sha512hex.value = cached.hashes[SHA512_ALG];
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      /* empty */
    }
  }

  async function loadHashing() {
    const runId = currentRunId;
    const targetFile = await loadFile();
    if (!targetFile || runId !== currentRunId) {
      return;
    }
    await loadCachedHashes(targetFile, () => runId === currentRunId);
  }

  return {
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
