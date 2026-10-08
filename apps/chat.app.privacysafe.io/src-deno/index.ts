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
/* eslint-disable @typescript-eslint/no-unused-vars */
import { setupGlobalReportingOfUnhandledErrors } from '../shared-libs/error-handling.ts';
import { initDebugLogging, makeLogger, setLogUserAddress } from '../shared-libs/logger.ts';
import { defer } from '../shared-libs/processes/deferred.ts';
import { MAX_ATTACHMENT_SIZE } from '../shared-libs/constants/attachment-limits.ts';
import { ensureDefaultAnonSenderMaxMsgSize } from './utils/workarounds.ts';
import { startComponentHeartbeat } from './utils/component-heartbeat.ts';
import {
  currentStageName,
  markComponentFailed,
  markComponentReady,
  startupStage,
} from './utils/startup-progress.ts';
import { dataset } from './dataset/index.ts';
import { localDataStore } from './services/local-data-store/local-data-store.ts';
import { createBlacklistTracker } from './services/contacts-service/contacts-blacklist.ts';
import { setBlockedRecipientsFilter } from '../shared-libs/blocked-recipients.ts';
import { chatService } from './services/chat-service/chat-service.ts';
import { exposeChatServiceOnIPC } from './services/chat-service/ipc-expose.ts';
import {
  exposeVideoGUIOpenerOnIPC,
  videoChatService,
} from './services/video-chat-service/video-chat-service.ts';
import { mailService } from './services/mail-service/mail-service.ts';
import { setPhantomReleaseBusyCheck } from './services/mail-sending-service/index.ts';
import type { ChatSrv, VideoChatSrv } from './types/index.ts';

setupGlobalReportingOfUnhandledErrors(true);

const log = makeLogger('ChatBackend');

// Before any capability is touched, and before the facades below: until this
// line existed, the first thing a run printed came after the databases were
// open, so a start that hung on storage looked exactly like a component that
// had never been asked to run at all (2026-09-10).
log.info(`chat background component process started`);
startComponentHeartbeat();

// IPC services are exposed before anything else, and before any storage is
// touched. The platform gives a caller 10 seconds from asking for a service to
// this component's exposeService() call, and the GUI asks for both of these
// while it starts; building the real services opens databases on synced
// storage, which on a freshly created user needs server round-trips and can
// alone overrun that limit - the GUI then dies with "Timeout in connecting to
// service AppChatsInternal". The facades behind these calls answer the
// handshake at once and make every call await the real service (see
// facadeOver in chat-service/ipc-expose.ts).
const chatSrvDeferred = defer<ChatSrv>();
const videoSrvDeferred = defer<VideoChatSrv>();
// A failed start rejects these with no one necessarily awaiting them yet;
// that must not surface as an unhandled rejection on top of the real error.
chatSrvDeferred.promise.catch(() => {});
videoSrvDeferred.promise.catch(() => {});
exposeChatServiceOnIPC(chatSrvDeferred.promise);
exposeVideoGUIOpenerOnIPC(videoSrvDeferred.promise);

try {
  // Diagnostic logging is off unless the launcher's app configuration turns it
  // on; the production bundle has no console at all (see ci/build-deno.js), so
  // everything worth seeing goes through the logger.
  // Every step of the start is named, timed, and - while it is running - says
  // so again every so often. The stage that stops reporting "done" is the one
  // that hung; without this the log simply ended and named nothing.
  await startupStage('debug-logging-config', () => initDebugLogging(), 10000);

  const ownAddr = await startupStage(
    'own-address', () => w3n.mailerid!.getUserId(), 10000,
  );
  // Explicit, not waiting on initDebugLogging's own lazy fetch: every line
  // from here on carries the address (util/logs mixes several test accounts).
  setLogUserAddress(ownAddr);

  // The most suspect step of them all: it opens SQLite files on synced
  // storage, and the platform log of the incident was full of fs-sync errors
  // at the very time this runs.
  const db = await startupStage('dataset', () => dataset(), 20000);
  const latestIncomingMsgTS = db.getLatestIncomingMsgTimestamp();

  const localDataStoreSrv = await startupStage(
    'local-data-store', () => localDataStore(), 15000,
  );
  const appDeviceId = localDataStoreSrv.getAppDeviceId();
  // At `info`, not `debug`: synchronization between the user's devices is
  // decided by this id, so a run in which two devices share one (two instances
  // on the same data folder) is indistinguishable from broken synchronization
  // unless every run prints it.
  log.info(`app device id is ${appDeviceId}`);
  await localDataStoreSrv.setLastReceivedMessageTimestamp(latestIncomingMsgTS || 0);

  const blacklistTracker = createBlacklistTracker(localDataStoreSrv);
  // Outgoing messages are kept from blocked addresses at the one place every
  // send funnels through; see blocked-recipients.ts for why it is a hook.
  setBlockedRecipientsFilter(recipients => recipients.filter(addr => !blacklistTracker.isBlacklisted(addr)));

  const { chatsSrv, syncActivity } = await startupStage(
    'chat-service', () => chatService(ownAddr, localDataStoreSrv, db, blacklistTracker), 30000,
  );
  // Started only now: chatService registers the handler that turns a change of
  // the blacklist into system records, and a change arriving before it is in
  // place is not replayed. Filtering of incoming messages does not wait for
  // this - the tracker is warm from its cache the moment it is created.
  blacklistTracker.start();
  // From here on the GUI's queued calls can run.
  chatSrvDeferred.resolve(chatsSrv);

  // Maintenance failures must not reach the outer catch: the service is already
  // resolved and working, and nothing after these passes depends on their
  // results, so losing one costs at worst uncollected garbage until the next
  // start. A single broken clean-up query used to close the whole component
  // here, leaving the user with no chats at all. A fundamentally broken
  // database is not masked: the very next calls below still hit the outer catch.
  const maintenancePass = async (name: string, pass: () => Promise<unknown>) => {
    try {
      await startupStage(`maintenance:${name}`, pass, 30000);
    } catch (err) {
      log.error(`start-up maintenance pass '${name}' failed:`, err);
      await w3n.log(
        'error',
        `Start-up maintenance pass '${name}' failed; the component continues without it.`,
        err,
      );
    }
  };
  await maintenancePass('deleteExpiredMessages', () => chatsSrv.deleteExpiredMessages(Date.now()));
  await maintenancePass('collectGarbageInAuxiliaryDB', () => chatsSrv.collectGarbageInAuxiliaryDB());
  await maintenancePass('removeExpiredInboxMessages', () => chatsSrv.removeExpiredInboxMessages(Date.now()));
  await maintenancePass('resolveStuckSyncingSelfMessages', () => chatsSrv.resolveStuckSyncingSelfMessages());
  await maintenancePass('collectGarbageInSyncVersions', () => chatsSrv.collectGarbageInSyncVersions(Date.now()));
  // Database writes are batched, so these five maintenance passes cost one
  // write per database file instead of one per record they touch.
  await maintenancePass('db.flush', () => db.flush());

  // One line telling where synchronization stands at this start: how many
  // changes of this device wait to go out, how many received changes wait for
  // their subject to appear, and how far the inbox has been read. All three are
  // the numbers asked for first when devices turn out to disagree.
  log.info(
    `sync state at startup: ${await chatsSrv.countPendingSyncPhantoms()} phantom(s) queued to send, `
      + `${db.countOrphanedSyncs()} buffered phantom(s) awaiting their chat or record, `
      + `inbox watermark ${localDataStoreSrv.getLastReceivedMessageTimestamp()}, `
      + `latest incoming message ${latestIncomingMsgTS ?? 'none'}`,
  );

  // Phantoms of changes made before the previous run ended - the journal is
  // what keeps a change whose phantom never went out from being invisible to
  // the user's other devices forever (see mail-sending-service/sync-phantoms.ts).
  await chatsSrv.releasePendingSyncPhantoms();

  const { videoChatSrv } = await startupStage(
    'video-chat-service',
    () => videoChatService(
      ownAddr, chatsSrv, db, chatsSrv.emitEventsOutward, localDataStoreSrv, blacklistTracker,
    ),
    20000,
  );
  videoSrvDeferred.resolve(videoChatSrv);

  // Resync asks and answers travel the same ASMail delivery as call
  // signalling, so they yield to a call that is on (see msg-resync.ts).
  chatsSrv.setResyncBusyCheck(() => videoChatSrv.hasAnyCallInProgress());

  // Phantoms travel that same delivery, so they yield to a call too. Nothing is
  // lost by waiting: the journal holds them, the call's own end releases them
  // (doAfterEndCall in video-chat-service.ts), and a pass that finds work left
  // re-arms itself (see the retry in sync-phantoms.ts).
  //
  // The narrow check, unlike the resync one above: a ringing call sends nothing
  // of ours, so holding the journal for an unanswered ring (up to 90 s) would
  // delay the user's other devices for nothing.
  setPhantomReleaseBusyCheck(() => videoChatSrv.hasAnyCallSignalling());

  // Records that buffered orphans are still waiting for do not reappear by
  // themselves (their carrier may be lost for good) - ask the user's other
  // devices to repeat them (see chat-service/utils/msg-resync.ts). Off the
  // start-up critical path and on a delay, so the pass neither slows the
  // start nor competes with a call the user starts right away; while a call
  // is on, it steps back and tries again later.
  const RESYNC_PASS_DELAY_MILLIS = 90_000;
  const RESYNC_PASS_RETRY_MILLIS = 5 * 60_000;
  const scheduleResyncPass = (delayMillis: number) => setTimeout(async () => {
    try {
      if (videoChatSrv.hasAnyCallInProgress()) {
        log.debug(`Resync pass deferred: a call is in progress`);
        scheduleResyncPass(RESYNC_PASS_RETRY_MILLIS);
        return;
      }
      await chatsSrv.requestResyncForStuckOrphans().catch(err =>
        w3n.log('error', `Resync pass for stuck orphans failed`, err),
      );
    } catch (err) {
      log.error(`scheduleResyncPass error:`, err);
      w3n.log('error', `scheduleResyncPass error`, err).catch(() => {});
    }
  }, delayMillis);
  scheduleResyncPass(RESYNC_PASS_DELAY_MILLIS);

  // Two copies of the app on one data folder share this device's identity, and
  // the result looks exactly like broken synchronization (see the watch itself).
  // The GUI is told too: a line in the log is no help to whoever is looking at
  // two windows and wondering why they disagree.
  localDataStoreSrv.startForeignInstanceWatch(() => chatsSrv.emitEventsOutward.common({
    updatedEntityType: 'sync-state',
    event: 'duplicate-device-instance',
  }));

  const stopDeliveryService = await startupStage(
    'mail-service',
    () => mailService({
      ownAddr,
      db,
      localDataStoreSrv,
      chatsSrv,
      videoChatSrv,
      syncActivity,
      blacklistTracker,
    }),
    20000,
  );
  // Before the line below, so that a ping arriving with it reads 'ready'.
  markComponentReady();
  log.debug(`all background services of the chat app have started`);
} catch (err) {
  // Calls queued behind the facades must fail rather than hang forever.
  markComponentFailed(err);
  chatSrvDeferred.reject(err);
  videoSrvDeferred.reject(err);
  // Which stage it died at, in a line of its own: the exception below carries
  // a message, not a place, and the two are rarely the same question.
  log.error(`start-up failed at stage '${currentStageName()}'; closing the component`);
  w3n.log(
    'error',
    `Error in a startup of instance with main services for chat. Can't proceed, and will close the whole component.`,
    err,
  );
  setTimeout(() => {
    try {
      w3n.closeSelf?.();
    } catch {
      // ignore
    }
  }, 100);
}

ensureDefaultAnonSenderMaxMsgSize(MAX_ATTACHMENT_SIZE).catch(err => {
  w3n.log('error', `Fail in checking and setting anonymous sender max message size`, err);
});
