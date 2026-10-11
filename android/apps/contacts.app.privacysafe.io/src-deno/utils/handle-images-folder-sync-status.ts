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
import { IMAGES_FOLDER } from '../constants.ts';
import type { ContactEvent } from '../../src/types/index.ts';
import { syncUpload } from '../utils/sync-upload.ts';
import { syncDownload } from '../utils/sync-download.ts';
import { syncAdopt } from '../utils/sync-adopt.ts';

/** @return whether any image file was actually downloaded. */
async function downloadImagesIfItNeed(
  fs: web3n.files.WritableFS,
  emitStorageEvent: (event: ContactEvent) => void,
): Promise<boolean> {
  let wasAnythingDownloaded = false;
  const imagesFolderList = await fs.listFolder(IMAGES_FOLDER);
  for (const image of imagesFolderList) {
    const imageFilePath = `${IMAGES_FOLDER}/${image.name}`;
    const imageFileSyncStatus = await fs.v?.sync?.status(imageFilePath);
    if (imageFileSyncStatus?.state === 'synced') {
      const isRemoteVersionOnDisk = await fs.v?.sync?.isRemoteVersionOnDisk(
        imageFilePath,
        imageFileSyncStatus!.synced!.latest!,
      );

      if (isRemoteVersionOnDisk !== 'complete') {
        await syncDownload({
          fs,
          path: imageFilePath,
          version: imageFileSyncStatus!.synced!.latest!,
          emitStorageEvent,
        });
        wasAnythingDownloaded = true;
      }
    }
  }
  return wasAnythingDownloaded;
}

export async function handleImagesFolderSyncStatus({ fs, emitStorageEvent }: {
  fs: web3n.files.WritableFS;
  emitStorageEvent: (event: ContactEvent) => void;
}) {
  const imagesFolderSyncStatus = await fs.v?.sync?.status(IMAGES_FOLDER);
  if (imagesFolderSyncStatus) {
    /**
     * Avatars that have just landed are not on screen yet: while their bytes
     * were missing, getImage answered '[error]', and the list item retries that
     * only a few times before giving up. So a download is reported, and the ui
     * asks for the list again.
     */
    let wasAnythingDownloaded = false;

    // eslint-disable-next-line default-case
    switch (imagesFolderSyncStatus.state) {
      case 'unsynced': {
        const imageFileList = await fs.listFolder(IMAGES_FOLDER);
        for (const imageFile of imageFileList) {
          const imageFilePath = `${IMAGES_FOLDER}/${imageFile.name}`;
          const imageFileSyncStatus = await fs.v?.sync?.status(imageFilePath);
          if (!imageFileSyncStatus) {
            continue;
          }

          // eslint-disable-next-line default-case
          switch (imageFileSyncStatus.state) {
            case 'unsynced': {
              await syncUpload({
                fs,
                path: imageFilePath,
                emitStorageEvent,
              });
              break;
            }

            case 'behind': {
              await syncAdopt({
                fs,
                path: imageFilePath,
                opts: { remoteVersion: imageFileSyncStatus.remote!.latest },
                emitStorageEvent,
              });
              await syncDownload({
                fs,
                path: imageFilePath,
                version: imageFileSyncStatus.remote!.latest!,
                emitStorageEvent,
              })
              wasAnythingDownloaded = true;
              break;
            }

            case 'synced': {
              const isRemoteVersionOnDisk = await fs.v?.sync?.isRemoteVersionOnDisk(
                imageFilePath,
                imageFileSyncStatus.synced!.latest!,
              );
              if (isRemoteVersionOnDisk !== 'complete') {
                await syncDownload({
                  fs,
                  path: imageFilePath,
                  version: imageFileSyncStatus.synced!.latest!,
                  emitStorageEvent,
                });
                wasAnythingDownloaded = true;
              }
              break;
            }
          }
        }

        await syncUpload({
          fs,
          path: IMAGES_FOLDER,
          emitStorageEvent,
          immediately: true,
        });
        break;
      }

      case 'behind': {
        await syncAdopt({
          fs,
          path: IMAGES_FOLDER,
          opts: { remoteVersion: imagesFolderSyncStatus.remote!.latest },
          emitStorageEvent,
          actionIfSuccess: async () => {
            wasAnythingDownloaded = await downloadImagesIfItNeed(fs, emitStorageEvent);
          },
        });
        break;
      }

      case 'conflicting': {
        const remoteVersion = imagesFolderSyncStatus.remote!.latest!;

        // Absorbing is what merges the two branches, but it writes a NEW local
        // folder version every time it is called - including when there is
        // nothing on the remote side to take. While the upload below cannot get
        // through, this pass runs once a minute, and in the live test of
        // 2026-09-14 that took the local folder version to 75 against a remote
        // of 3. So the diff decides whether there is anything to absorb.
        const diff = await fs.v?.sync?.diffCurrentAndRemoteFolderVersions(
          IMAGES_FOLDER, remoteVersion,
        );
        const isThereAnythingRemoteOnly = !!diff && (
          !!diff.added?.inRemote?.length
          || !!diff.removed?.inRemote?.length
          || !!diff.nameOverlaps?.length
        );

        if (isThereAnythingRemoteOnly) {
          await fs.v?.sync?.absorbRemoteFolderChanges(IMAGES_FOLDER, { postfixForNameOverlaps: '_[ keep ]' });
          wasAnythingDownloaded = await downloadImagesIfItNeed(fs, emitStorageEvent);
        }

        // And the merged folder has to be PUBLISHED, which this branch never
        // did - unlike the `unsynced` one above. Without it the folder stayed
        // `conflicting` for the life of the process, and the watchdog kept
        // reporting unpublished changes while every pass absorbed again.
        // Out of a conflicting state the platform requires the version to be
        // named, hence remoteVersion + 1.
        await syncUpload({
          fs,
          path: IMAGES_FOLDER,
          opts: { uploadVersion: remoteVersion + 1 },
          emitStorageEvent,
          immediately: true,
        });
        break;
      }
    }

    if (wasAnythingDownloaded) {
      emitStorageEvent({ event: 'update:contact-list' });
    }
  }
}
