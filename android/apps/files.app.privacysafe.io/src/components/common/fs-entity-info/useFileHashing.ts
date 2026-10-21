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

  const isHashingProcStopped = ref(false);

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

  async function readAndHashProcess(
    content: FileByteSource,
    hasher: { update: (chunk: Uint8Array) => void },
    reportProgress: (bytesDone: number) => void,
    shouldStop: () => boolean,
  ): Promise<void> {
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
        console.info('Hashing canceled by stop signal');
        break;
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

    // hash the last chunk
    hashChunkAndReport();
  }

  async function loadFile() {
    if (!file.value) {
      const fs = getFs(fsId.value);
      file.value = await fs.writableFile(path.value);
    }
  }

  async function calculateHash() {
    await loadFile();
    isHashingProcStopped.value = false;
    await runSha256();
    await runSha512();
  }

  async function runSha256() {
    try {
      calculating256.value = true;
      const sha256 = await createSHA256();
      sha256.init();

      const content = await file.value!.getByteSource();

      await readAndHashProcess(
        content!,
        sha256,
        bytesDone => {
          sha256progress.value = Math.floor((bytesDone / fileSize.value) * 100);
        },
        () => isHashingProcStopped.value,
      );

      const hashInHex = sha256.digest('hex');
      sha256hex.value = hashInHex;
      await cacheHashInXAttrOf(file.value!, fileMTime.value!, fileSize.value!, SHA256_ALG, hashInHex);
    } finally {
      calculating256.value = false;
    }
  }

  async function runSha512() {
    try {
      calculating512.value = true;
      const sha512 = await createSHA512();
      sha512.init();

      const content = await file.value!.getByteSource();

      await readAndHashProcess(
        content!,
        sha512,
        bytesDone => {
          sha512progress.value = Math.floor((bytesDone / fileSize.value) * 100);
        },
        () => isHashingProcStopped.value,
      );

      const hashInHex = sha512.digest('hex');
      sha512hex.value = hashInHex;
      await cacheHashInXAttrOf(file.value!, fileMTime.value!, fileSize.value!, SHA512_ALG, hashInHex);
    } finally {
      calculating512.value = false;
    }
  }

  function stopHashingProcess() {
    isHashingProcStopped.value = true;
    sha256hex.value = null;
    sha512hex.value = null;
    calculating256.value = false;
    calculating512.value = false;
    sha256progress.value = 0;
    sha512progress.value = 0;
    file.value = null;
  }

  async function loadCachedHashes() {
    try {
      const cached = await readCachedHashes(file.value!);
      if (!cached) {
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
    await loadFile();
    await loadCachedHashes();
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
