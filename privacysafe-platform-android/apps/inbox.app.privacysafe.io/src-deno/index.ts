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
import { setupGlobalReportingOfUnhandledErrors } from '../shared/utils/error-handling.ts';
import { initDebugLogging, makeLogger, setLogUserAddress } from '../shared/utils/logger.ts';
import { defer } from '../shared/utils/processes/deferred.ts';
import { MAX_ATTACHMENT_SIZE } from '../shared/constants/attachment-limits.ts';
import { ensureDefaultAnonSenderMaxMsgSize } from './utils/workarounds.ts';
import { migrateAppDataToLocalFS } from './utils/migrate-to-local-fs.ts';
import { dataset } from './dataset/index.ts';
import { createBlacklistTracker } from './services/contacts-service/contacts-blacklist.ts';
import { makeLabelledFileStoreIn } from './services/file-store/labelled-file-store.ts';
import { createStartupEvents } from './services/inbox-service/events.ts';
import { inboxService } from './services/inbox-service/inbox-service.ts';
import { exposeInboxServiceOnIPC, exposeInboxServiceToOtherApps } from './services/inbox-service/ipc-expose.ts';
import { mailService } from './services/mail-service/mail-service.ts';
import { makeSyncActivityTracker } from './services/sync/sync-activity.ts';
import { runSyncMaintenance } from './services/sync/sync-maintenance.ts';
import { makeSyncOutbox } from './services/sync/sync-outbox.ts';
import type { InboxSrv } from './types/inbox-srv.types.ts';

setupGlobalReportingOfUnhandledErrors(true);

const log = makeLogger('InboxBackend');

/**
 * How long after the app is called started the housekeeping pass runs. Not on
 * the critical path, because there can be a serverful of removeMsg calls in it -
 * unlike the first releasePending(), which goes at once: an unreleased phantom is
 * the whole reason the journal exists.
 */
const SYNC_MAINTENANCE_DELAY_MS = 15_000;

// Made before anything is awaited, so that the GUI can be told what is going on
// from the first moment it can connect - which is right after the line below.
const startup = createStartupEvents();

const inboxSrvDeferred = defer<InboxSrv>();
inboxSrvDeferred.promise.catch(() => {});
exposeInboxServiceOnIPC(inboxSrvDeferred.promise, { watchStartup: startup.watch });
exposeInboxServiceToOtherApps(inboxSrvDeferred.promise);

// The address is needed by the synchronization outbox - a phantom's one
// recipient is the user themself - so it is a promise of its own rather than a
// step inside the logging setup it used to belong to.
const userIdPromise = w3n.mailerid!.getUserId();

// Only logging needs these two, and nothing below waits on logging.
initDebugLogging()
  .then(() => userIdPromise)
  .then(setLogUserAddress)
  .catch(err => w3n.log('error', `Failed to set up logging of the inbox backend`, err));

// Phase timings of the start, reported as one line at the end. This is where a
// regression in how long the app takes to answer becomes visible - and there is
// no other place to see it from, the component having no UI of its own.
const startedAt = Date.now();
const phases: string[] = [];
let phaseStartedAt = startedAt;
function phaseDone(name: string): void {
  const now = Date.now();
  phases.push(`${name} ${now - phaseStartedAt}ms`);
  phaseStartedAt = now;
}

try {
  // Before either of the two things it moves is opened.
  await migrateAppDataToLocalFS(startup.emit);
  phaseDone('migration');

  const [db, fileStore] = await Promise.all([
    dataset(),
    makeLabelledFileStoreIn('mail-app-files'),
  ]);
  phaseDone('db+file-store');

  // Warm from its cache the moment it is made, so that the catch-up scan below
  // already knows who is blocked; the connection to the contacts app catches up
  // behind it, taking seconds of retries it is not worth waiting for.
  const blacklist = createBlacklistTracker(db);
  blacklist.start();

  const ownAddr = await userIdPromise;
  const sync = await makeSyncOutbox(db, ownAddr);
  const activity = makeSyncActivityTracker({
    countOutboundPending: () => sync.countAwaitingRelease(),
    // While this device has never seen a phantom from another device of this
    // user, nothing is reported at all: a user with a single device has no
    // synchronization to be told about, and the phantoms in their inbox are
    // their own copies coming back.
    isReportable: () => db.hasSeenOtherDevice(),
  });
  sync.setOutcomeSinks({
    pass: outcome => activity.noteOutboundPass(outcome),
    delivery: outcome => activity.noteOutboundDeliveryOutcome(outcome),
  });

  // Filled in below, once the mail service exists. A restore resets the
  // watermark to 0 and asks for a pass over the inbox right afterwards, and only
  // the mail service can make one - which is built after the inbox service that
  // holds the backup service.
  const rescan = { run: async () => {} };

  const {
    inboxSrv,
    emit,
    beginBulkReplay,
    endBulkReplay,
    persistMail,
    handleSync,
  } = await inboxService(db, fileStore, sync, ownAddr, startup.watch, blacklist, activity, rescan);
  activity.onChange(view => emit({ entity: 'sync', event: 'activity', view }));
  inboxSrvDeferred.resolve(inboxSrv);
  phaseDone('service-ready');

  // The whole of mailService() is the start-up replay: the catch-up scan of the
  // inbox, and after it the backlog of deliveries - both of which walk a message
  // through its history one change at a time. This is the one place that knows
  // it, so the window is opened here rather than inside.
  //
  // The indicator's own events are not held back, which is what lets the GUI say
  // "Synchronizing…" through all of it.
  let mail: Awaited<ReturnType<typeof mailService>>;
  beginBulkReplay();
  try {
    mail = await mailService({
      db,
      emit,
      sync,
      persistMail,
      handleSync,
      ownAddr,
      blacklist,
      activity,
    });
  } finally {
    endBulkReplay();
  }
  rescan.run = () => mail.catchUp();
  phaseDone('mail-service');

  await ensureDefaultAnonSenderMaxMsgSize(MAX_ATTACHMENT_SIZE);

  // Whatever the steps above scheduled is in the file before the app is called
  // started; from here on batching has ongoing work to batch.
  await db.flush();
  phaseDone('rest');

  startup.done();

  log.info(`started in ${Date.now() - startedAt}ms: ${phases.join(', ')}`);
  // Printed at every start, and its absence cost chat.app a whole debugging
  // session: two copies of the app on one data folder share the device id, every
  // phantom then looks "own" on both, and from the outside that is
  // indistinguishable from broken synchronization.
  log.info(
    `device ${db.getAppDeviceId()}; sync state at startup: `
      + `${db.countPendingSyncPhantoms()} phantom(s) in the journal, `
      + `${db.countOrphanedSyncs()} buffered phantom(s), `
      + `${db.countPendingInboxRemovals()} deferred inbox removal(s), `
      + `watermark ${db.getAppState().lastReceivingTimestamp || 0}, `
      + `another device ${db.hasSeenOtherDevice() ? 'seen' : 'not seen yet'}`,
  );

  // Picks up everything the previous run left unsent.
  sync.releasePending().catch(err => log.error(`The first pass over the journal failed`, err));

  setTimeout(
    () => {
      runSyncMaintenance(db).catch(err => log.error(`Sync maintenance pass failed`, err));
    },
    SYNC_MAINTENANCE_DELAY_MS,
  );
} catch (err) {
  startup.fail(err);
  inboxSrvDeferred.reject(err);
  w3n.log(
    'error',
    `Error in a startup of instance with main services for inbox. Can't proceed, and will close the whole component.`,
    err,
  );
  setTimeout(() => w3n.closeSelf!(), 100);
}
