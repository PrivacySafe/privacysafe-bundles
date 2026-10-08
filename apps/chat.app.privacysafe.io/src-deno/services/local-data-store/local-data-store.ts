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
import { DELIVERY_SERVICE_DATA_FILE_NAME } from '../../../shared-libs/constants/index.ts';
import { SingleProc } from '../../../shared-libs/processes/single.ts';
import { randomStr } from '../../../shared-libs/randomStr.ts';
import type { LocalDataStore, DeliveryServiceData } from '../../types';

/** How often the local data file is re-read to see whose stamp it carries. */
const FOREIGN_INSTANCE_CHECK_MILLIS = 30_000;

/**
 * How many consecutive "the version of our own file is gone" reads make a
 * verdict (see startForeignInstanceWatch). Three, i.e. a minute and a half: the
 * real case persists, while one odd read must never accuse a healthy run.
 */
const NOT_FOUND_READS_FOR_VERDICT = 3;

export async function localDataStore(): Promise<LocalDataStore> {
  const proc = new SingleProc();

  let fs: web3n.files.WritableFS;
  let file: web3n.files.WritableFile;
  let needsSaving = false;
  let data: DeliveryServiceData;
  /**
   * Stamp of this process's run of the component, written into the same file as
   * appDeviceId. Two instances of the app started on one data folder share that
   * file, and hence that device identity - see startForeignInstanceWatch().
   */
  const ourInstanceStamp = randomStr(12);

  async function initialize(): Promise<void> {
    fs = await w3n.storage!.getAppLocalFS();
    file = await fs.writableFile(DELIVERY_SERVICE_DATA_FILE_NAME);

    const appFormFactor = (await w3n.ui?.uiFormFactor()) || '';
    const appFormFactorParcedValue = appFormFactor.split('+');
    const appDeviceId = appFormFactorParcedValue[0]
      ? `${appFormFactorParcedValue[0]}-${randomStr(20)}`
      : `app-${randomStr(20)}`;

    if (file.isNew) {
      data = {
        appDeviceId,
        lastReceivedMessageTimestamp: 0,
      };
    } else {
      data = await file.readJSON<DeliveryServiceData>();
      if (!data.appDeviceId) {
        data.appDeviceId = appDeviceId;
      }
    }

    // Written unconditionally, because the stamp is new on every run: it is what
    // the foreign-instance watch below compares against.
    data.instanceStamp = ourInstanceStamp;
    await file.writeJSON(data);
  }

  async function saveOrderly() {
    needsSaving = true;
    await proc.startOrChain(async () => {
      if (needsSaving) {
        await file.writeJSON(data);
        needsSaving = false;
      }
    });
  }

  function getAppDeviceId() {
    return data.appDeviceId;
  }

  function getLastReceivedMessageTimestamp() {
    return data.lastReceivedMessageTimestamp;
  }

  async function setLastReceivedMessageTimestamp(ts: number) {
    if (ts > data.lastReceivedMessageTimestamp) {
      data.lastReceivedMessageTimestamp = ts;
      await saveOrderly();
    }
  }

  /**
   * Issues a stamp for a change made on this device, to order it against
   * changes made on the user's other devices (a hybrid logical clock).
   *
   * Taking max() with the highest stamp seen so far guarantees that a change
   * made after seeing another device's change always gets a greater stamp, no
   * matter how far this device's wall clock is off. Truly concurrent changes -
   * neither device aware of the other - still fall back on wall clocks, but
   * every device resolves them identically, since the ordering token is a
   * total order (see isNewerToken in chat-service/utils/sync-versions.ts).
   */
  async function nextSyncStamp(): Promise<number> {
    const ts = Math.max(Date.now(), (data.lastSyncClockTs ?? 0) + 1);
    data.lastSyncClockTs = ts;
    await saveOrderly();
    return ts;
  }

  /**
   * Advances the clock to account for a stamp seen in a received phantom.
   */
  async function observeSyncStamp(ts: number) {
    if (ts > (data.lastSyncClockTs ?? 0)) {
      data.lastSyncClockTs = ts;
      await saveOrderly();
    }
  }

  /**
   * Whether this device has ever seen a phantom from another device of this
   * user, i.e. whether this user synchronizes with anything at all.
   */
  function hasSeenOtherDevice(): boolean {
    return !!data.otherDeviceSeen;
  }

  /**
   * Records the first phantom from another device of this user.
   *
   * Written once and never updated: the question it answers is "does this user
   * have a second device", and the answer does not change back. Keeping it to
   * the first one also keeps this off the write path - every phantom after it
   * costs a comparison and nothing else.
   */
  async function noteOtherDeviceSeen(deviceId: string): Promise<void> {
    if (data.otherDeviceSeen || !deviceId) {
      return;
    }
    data.otherDeviceSeen = { deviceId, at: Date.now() };
    await saveOrderly();
    await w3n.log(
      'info',
      `First phantom from another device of this user (${deviceId}); this device is `
        + `synchronizing from now on, and says so in the GUI.`,
    );
  }

  /**
   * Issues an identifier for a call this device is about to host, of the form
   * `<hostAddr>#<appDeviceId>-<counter>` (see WebRTCMsg.callSessionId).
   *
   * The address part makes ids of different participants distinguishable, and
   * the counter - persisted, so a restart cannot repeat it - makes two calls
   * this device hosts in the same chat distinguishable. That is what lets a
   * signal of a finished call be told apart from a signal of the current one
   * without inferring it from the signal's age.
   *
   * The device id is in there because the address is the *user's*, while the
   * counter is this device's own: without it the first call hosted by one
   * device of a user and the first call hosted by another get the very same id.
   * Harmless while session ids were only ever compared, but a chat record's id
   * is now derived from the session (see chatMessageIdForCallEvent), and a
   * record whose id is already taken is skipped by the receiving side - the
   * second call would have gone missing from the history entirely, duration and
   * all.
   *
   * Nothing parses this string apart from the host address, and that rule is
   * the one thing callers may rely on: **everything before the first `#` is the
   * host's address** (see hostAddrOfCallSession).
   */
  async function nextCallSessionId(hostAddr: string): Promise<string> {
    const counter = (data.lastCallSessionCounter ?? 0) + 1;
    data.lastCallSessionCounter = counter;
    await saveOrderly();
    return `${hostAddr}#${data.appDeviceId}-${counter}`;
  }

  /**
   * Watches for another instance of the app working with this same local data
   * folder, and says so once.
   *
   * It is not a runtime condition but a misconfiguration - two copies started on
   * one data folder, which the platform allows with --allow-multi-instances -
   * and it is worth detecting because of how it looks from the outside: both
   * instances read the same appDeviceId, so every phantom in the shared inbox is
   * "from this device" on both of them, no change is ever applied, and the
   * databases are written behind each other's back. That reads exactly like
   * broken synchronization, and nothing else in the logs contradicts it.
   *
   * The check is a re-read of the file, and there are two ways it comes back
   * with the answer:
   *
   *  - the stamp in it is not ours, i.e. the other instance wrote the file last;
   *  - the read fails with **not found**, which is what a live run actually
   *    showed: the other instance's core wrote a new version of the object and
   *    removed the one our core knows about, so our own file reads as a missing
   *    version file. Only this component ever writes this file, and its object
   *    was read successfully at start, so the version disappearing under us means
   *    the same thing as a foreign stamp. Narrow on purpose: any other read error
   *    (decryption, IO) says nothing about who else writes here, and three
   *    consecutive not-found reads are required, so that one odd read is never a
   *    verdict while the real case - which does not go away - is caught in a
   *    minute and a half.
   *
   * Fires once and stops - our own saves keep re-claiming the stamp, so a
   * repeating check would produce a stream of identical errors (each instance
   * still reports its own once, which is what is wanted).
   */
  function startForeignInstanceWatch(onForeign: (evidence: string) => void): () => void {
    let consecutiveNotFoundReads = 0;

    async function reportAndStop(evidence: string): Promise<void> {
      clearInterval(interval);
      await w3n.log(
        'error',
        `Another instance of this app works with the same local data folder (${evidence}). `
          + `Both instances therefore use device id ${data.appDeviceId}, so neither applies the `
          + `other's sync phantoms and both write the same databases. Synchronization between `
          + `devices cannot work in such a run - start the second instance with its own data folder.`,
      );
      onForeign(evidence);
    }

    const interval = setInterval(async () => {
      try {
        let stored: DeliveryServiceData;
        try {
          stored = await fs.readJSONFile<DeliveryServiceData>(DELIVERY_SERVICE_DATA_FILE_NAME);
          consecutiveNotFoundReads = 0;
        } catch (err) {
          const isNotFound = !!(err as web3n.files.FileException)?.notFound;
          consecutiveNotFoundReads = isNotFound ? (consecutiveNotFoundReads + 1) : 0;
          await w3n.log(
            'error',
            `Failed to re-read ${DELIVERY_SERVICE_DATA_FILE_NAME}`
              + (isNotFound ? ` (not found, ${consecutiveNotFoundReads} time(s) in a row)` : ''),
            err,
          );
          if (consecutiveNotFoundReads >= NOT_FOUND_READS_FOR_VERDICT) {
            await reportAndStop(
              `${DELIVERY_SERVICE_DATA_FILE_NAME} cannot be read any more - the version of its object `
                + `that this instance knows was removed from under it`,
            );
          }
          return;
        }

        const foreignStamp = stored.instanceStamp;
        if (!foreignStamp || (foreignStamp === ourInstanceStamp)) {
          return;
        }
        await reportAndStop(
          `${DELIVERY_SERVICE_DATA_FILE_NAME} now carries instance stamp ${foreignStamp} `
            + `instead of ours ${ourInstanceStamp}`,
        );
      } catch (err) {
        w3n.log('error', 'Foreign instance watch pass failed', err).catch(() => {});
      }
    }, FOREIGN_INSTANCE_CHECK_MILLIS);

    return () => clearInterval(interval);
  }

  function getCachedBlacklist(): string[] | undefined {
    return Array.isArray(data.cachedBlacklist) ? [...data.cachedBlacklist] : undefined;
  }

  async function setCachedBlacklist(list: string[]): Promise<void> {
    data.cachedBlacklist = [...list];
    await saveOrderly();
  }

  await initialize();

  return {
    getAppDeviceId,
    startForeignInstanceWatch,
    getLastReceivedMessageTimestamp,
    setLastReceivedMessageTimestamp,
    nextSyncStamp,
    observeSyncStamp,
    hasSeenOtherDevice,
    noteOtherDeviceSeen,
    nextCallSessionId,
    getCachedBlacklist,
    setCachedBlacklist,
  };
}
