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
// Contacts synchronise through the 3N synced file system rather than through
// messages, so what the service does is observable as file state. The manifest
// grants `storage: { appFS: 'default' }` to the GUI components as well as to the
// deno component, which means this window opens the very same root the service
// owns — no second device needed to watch the sync happen.
//
// Everything here READS. The service holds the db file open and owns every
// write to it; writing from this window would race with it. The one spec that
// would need a write — feeding a diverging version to force a conflict — is
// left disabled below, with the reasoning.
import { itCond, xitCond, skipSpecIfUnresponsive } from '../libs-for-tests/jasmine-utils.js';
import { appContactsSrvProxy } from '@main/common/services/services-provider.js';
import { NEW_EMPTY_CONTACT_ID } from '@main/common/constants/index.js';
import { CONTACTS_DB_FILE, IMAGES_FOLDER } from '@deno/constants.js';
import { sleep } from '../lib-common/processes/sleep.js';
import type { Person } from '@main/types/index.js';

declare const w3n: web3n.testing.CommonW3N;

const OP_TIMEOUT = 20000;
const SPEC_TIMEOUT = 40000;
const CLEANUP_TIMEOUT = 120000;

/** The db upload is debounced by 500ms, so give it room before reading status. */
const UPLOAD_SETTLE_MILLIS = 3000;

const IMG_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function isPerson(res: Person | { errorType: string }): res is Person {
  return !('errorType' in res);
}

describe(`Synced file system`, () => {

  let fs: web3n.files.WritableFS;
  const contactIdsToClean = new Set<string>();
  const imageIdsToClean = new Set<string>();

  beforeAll(async () => {
    fs = await w3n.storage!.getAppSyncedFS!();
  });

  // See contacts-service: a hook that outruns jasmine's 5s default fails the
  // whole suite, and this cleanup saves the db once per removal.
  afterAll(async () => {
    for (const id of contactIdsToClean) {
      await appContactsSrvProxy.deleteContact(id).catch(() => undefined);
    }
    for (const id of imageIdsToClean) {
      await appContactsSrvProxy.deleteImage(id).catch(() => undefined);
    }
  }, CLEANUP_TIMEOUT);

  async function statusOf(path: string): Promise<web3n.files.SyncStatus|undefined> {
    return fs.v?.sync?.status(path);
  }

  async function addContact(name?: string): Promise<Person> {
    const mail = `fs-spec-${Date.now()}-${Math.floor(Math.random() * 1e6)}@3nweb.com`;
    const res = await skipSpecIfUnresponsive(
      `adding contact ${mail}`, OP_TIMEOUT,
      () => appContactsSrvProxy.upsertContact({ id: NEW_EMPTY_CONTACT_ID, mail, name }),
    );
    if (!isPerson(res)) {
      throw new Error(`Failed to add a contact: ${res.errorMessage}`);
    }
    contactIdsToClean.add(res.id);
    return res;
  }

  itCond(`holds the app's own root, the same one the service writes to`, async () => {
    expect(fs).withContext(`synced fs is reachable from the window`).toBeDefined();
    expect(fs.type).withContext(`fs kind`).toBe('synced');
    expect(fs.v).withContext(`versioned api`).toBeDefined();
    expect(fs.v!.sync).withContext(`sync api`).toBeDefined();
  }, SPEC_TIMEOUT);

  // The root used to be able to sit in 'conflicting' indefinitely: it was
  // diffed into the log and never resolved. The service now reconciles it
  // BEFORE it opens any local object, so by the time this window can read the
  // status, the root is settled one way or another.
  itCond(`does not leave its root folder in a conflicting state`, async () => {
    const status = await statusOf('');

    expect(status).withContext(`root sync status`).toBeDefined();
    expect(status!.state)
    .withContext(`root state, got '${status?.state}'`).not.toBe('conflicting');
  }, SPEC_TIMEOUT);

  // A second contacts-db beside the server's own one is what a root conflict is
  // made of: writableFile sees only the current version of the folder, so on a
  // root that is still 'behind' it creates a new object under a name the server
  // already uses. Presence here is the cheap end of that check.
  itCond(`carries the contacts db file`, async () => {
    expect(await fs.checkFilePresence(CONTACTS_DB_FILE))
    .withContext(`${CONTACTS_DB_FILE} exists`).toBeTrue();
  }, SPEC_TIMEOUT);

  itCond(`carries the images folder`, async () => {
    expect(await fs.checkFolderPresence(IMAGES_FOLDER))
    .withContext(`${IMAGES_FOLDER} exists`).toBeTrue();
  }, SPEC_TIMEOUT);

  // Every local save leaves the file ahead of the server for a moment; the
  // debounced upload then brings it back to 'synced'. A file stuck 'unsynced'
  // is exactly the state that used to poison the next save with
  // "Version N already exists".
  itCond(`brings the db file back to synced after a save`, async () => {
    await addContact('FS Spec');

    await sleep(UPLOAD_SETTLE_MILLIS);
    const status = await statusOf(CONTACTS_DB_FILE);

    expect(status).withContext(`db file sync status`).toBeDefined();
    expect(['synced', 'behind'])
    .withContext(`state after a save, got '${status?.state}'`)
    .toContain(status!.state);
  }, SPEC_TIMEOUT);

  itCond(`never leaves the db file in a conflicting state after its own saves`, async () => {
    await addContact('FS Spec Two');
    await addContact('FS Spec Three');

    await sleep(UPLOAD_SETTLE_MILLIS);

    expect((await statusOf(CONTACTS_DB_FILE))!.state)
    .withContext(`state after two saves of our own`).not.toBe('conflicting');
  }, SPEC_TIMEOUT * 2);

  itCond(`puts both the avatar and its thumbnail into the images folder`, async () => {
    const avatarId = await appContactsSrvProxy.addImage({ base64: IMG_BASE64 });
    imageIdsToClean.add(avatarId);
    await appContactsSrvProxy.addImage({
      base64: IMG_BASE64, id: `${avatarId}-mini`, withUploadParentFolder: true,
    });

    const names = (await fs.listFolder(IMAGES_FOLDER))
    .filter(e => e.isFile).map(e => e.name);

    expect(names).withContext(`full size file`).toContain(avatarId);
    expect(names).withContext(`thumbnail file`).toContain(`${avatarId}-mini`);
  }, SPEC_TIMEOUT);

  // Collection is EVENTUAL: an orphan whose upload is in flight is left for the
  // next sweep, because deleting it makes the core reject its own background
  // removeCurrentVersion as unhandled.
  itCond(`removes an orphaned image file from the folder`, async () => {
    const orphanId = await appContactsSrvProxy.addImage({ base64: IMG_BASE64 });
    expect((await fs.listFolder(IMAGES_FOLDER)).map(e => e.name))
    .withContext(`orphan is there before the sweep`).toContain(orphanId);

    let orphanGone = false;
    for (let attempt = 0; attempt < 8 && !orphanGone; attempt += 1) {
      await appContactsSrvProxy.removeUnnecessaryImageFiles();
      orphanGone = !(await fs.listFolder(IMAGES_FOLDER)).some(e => (e.name === orphanId));
      if (!orphanGone) {
        await sleep(1000);
      }
    }

    expect(orphanGone).withContext(`orphan is gone after a sweep`).toBeTrue();
  }, SPEC_TIMEOUT * 2);

  itCond(`keeps the images folder out of a conflicting state`, async () => {
    const status = await statusOf(IMAGES_FOLDER);

    if (status) {
      expect(status.state)
      .withContext(`images folder state, got '${status.state}'`).not.toBe('conflicting');
    }
  }, SPEC_TIMEOUT);

  itCond(`re-running the initial sync leaves the contact list intact`, async () => {
    const created = await addContact('FS Spec Resync');
    const before = (await appContactsSrvProxy.getContactList()).map(c => c.id).sort();

    await skipSpecIfUnresponsive(
      `initial sync process`, OP_TIMEOUT,
      () => appContactsSrvProxy.initialSyncProcess(),
    );

    const after = (await appContactsSrvProxy.getContactList()).map(c => c.id).sort();
    expect(after).withContext(`list is unchanged by a re-sync`).toEqual(before);
    expect(after).withContext(`the new contact survived`).toContain(created.id);
    expect(new Set(after).size).withContext(`no duplicates appeared`).toBe(after.length);
  }, SPEC_TIMEOUT * 2);

  // Disabled deliberately, not left half-written. Forcing a genuine conflict
  // means uploading a diverging version of the db file from this window, and
  // that has two problems worth solving before it is switched on:
  //
  //  - the deno service holds the same file open and owns every write to it,
  //    so a write from here races with it rather than simulating another
  //    device;
  //  - if the resolution then goes wrong, the test user's contact db is left
  //    damaged, and test users are REUSED between runs — the damage would
  //    outlive this run and be read as a defect by the next one.
  //
  // The merge itself is covered by unit tests over resolveDbFileConflict,
  // handleDbFileSyncStatus and resolveRootFolderConflict, where both sides are
  // inputs. What this spec would add is confidence that the platform reports
  // 'conflicting' where those tests assume it does. Enabling it needs a
  // service-side entry point that accepts a remote version for the purpose, so
  // that the service stays the only writer.
  //
  // The same holds, more strongly, for a conflict of the ROOT folder: a real
  // name overlap needs a second device running the same account, and the stand
  // cannot give one - `users` in test-setup.json substitutes the number into
  // `idTemplate`, so each instance gets a DIFFERENT address. That path is
  // verified by hand, per the plan.
  xitCond(`resolves a synthetic conflict without losing or duplicating contacts`);

});
