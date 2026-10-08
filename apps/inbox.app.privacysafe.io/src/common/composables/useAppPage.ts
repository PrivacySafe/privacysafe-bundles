import { computed, inject, onBeforeMount, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { THEME_KEY, DIALOGS_KEY, DialogsPlugin, VUEBUS_KEY, VueBusPlugin } from '@v1nt1248/3nclient-lib/plugins';
import { getRandomId } from '@v1nt1248/3nclient-lib/utils';
import type { Ui3nDialogEvent } from '@v1nt1248/3nclient-lib';
import type { AppGlobalEvents, AppMenuAction, PreparedMessageData } from '@common/types';
import type { InboxUpdateEvent, StartupEvent } from '@deno/types/inbox-srv.types';
import {
  useAppStore,
  useBackupStore,
  useContactsStore,
  useFoldersStore,
  useMessagesStore,
  useSendingStore,
} from '@common/store';
import { useBackupRestore } from '@common/composables/useBackupRestore';
import { useCreateMsgActions } from '@common/composables/useCreateMsgActions';
import { useForceRefreshData } from '@common/composables/useForceRefreshData';
import { inboxSrv } from '@common/services/services-provider';
import { SingleProc } from '@shared/utils/processes/single';
import { makeLogger } from '@shared/utils/logger';
import CreateMsgDialog from '@common/components/dialogs/create-msg-dialog/create-msg-dialog.vue';
import ManageBlocksDialog from '@common/components/dialogs/manage-blocks-dialog/manage-blocks-dialog.vue';

const log = makeLogger('AppPage');

export function useAppPage(mobileMode?: boolean) {
  const { setTheme } = inject(THEME_KEY)!;
  const $bus = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;
  const $dialogs = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const { t } = useI18n();

  const unsub = ref<() => void>();
  const unsubWatch = ref<() => void>();
  const unsubStartup = ref<() => void>();
  /** What the overlay says under the spinner while the app is coming up. */
  const startupStatusText = ref('');

  const router = useRouter();

  const appStore = useAppStore();
  const {
    appVersion,
    user: me,
    connectivityStatus,
    colorTheme,
    isMobileMode,
    commonLoading,
    customLogoSrc,
    syncActivity,
  } = storeToRefs(appStore);
  const {
    getAppState,
    applyAppState,
    getSyncActivityState,
    applySyncActivity,
    readAndStartWatchingAppConfig,
    stopWatchingAppConfig,
    getAppVersion,
    getUser,
    getConnectivityStatus,
    setAppWindowSize,
    setMobileMode,
    setCommonLoading,
  } = appStore;
  const { loadFolders } = useFoldersStore();
  const {
    getContactList,
    fetchBlacklist,
    primeBlacklistFromBackend,
    startBlacklistWatch,
    stopWatching: stopBlacklistWatch,
  } = useContactsStore();
  const messagesStore = useMessagesStore();
  const { getMessages, deleteMessages, applyMessageEvent } = messagesStore;
  const sendingStore = useSendingStore();
  const { applySendingEvent } = sendingStore;
  const backupStore = useBackupStore();
  const { onBackupProgress, onRestoreProgress } = backupStore;

  const { saveMsgToDraft } = useCreateMsgActions();
  const { startBackupWorkflow, runRestoreWorkflow } = useBackupRestore();
  const { forceRefreshData } = useForceRefreshData();

  // The store holds what the setting says; the plugin puts it on the document.
  // Declared in setup, so that the watcher belongs to the component's scope and
  // ends with it - and `immediate`, because the first read of the config may
  // land either before or after this page is set up.
  watch(colorTheme, id => setTheme(id), { immediate: true });

  const connectivityStatusText = computed(() =>
    connectivityStatus.value === 'online' ? 'app.status.connected.online' : 'app.status.connected.offline',
  );
  const connectivityTimerId = ref<ReturnType<typeof setInterval> | undefined>();

  const updatesQueue: InboxUpdateEvent[] = [];
  const updatesProc = new SingleProc();
  /**
   * Whether the queue may be drained yet.
   *
   * The subscription goes on BEFORE the first read of the lists, so that a change
   * landing in between is not lost - it used to fall into the gap between
   * getMessages() and the subscription and stay invisible until the next change
   * to the same message. But it must not be APPLIED before that read either:
   * getMessages() replaces messageList wholesale with a snapshot taken earlier,
   * which would wipe it again. So events wait here until the initial load is in.
   */
  let initialLoadDone = false;

  function drainUpdatesIfReady(): void {
    if (initialLoadDone && !updatesProc.getP()) {
      updatesProc.start(processQueuedUpdateEvents);
    }
  }

  async function processQueuedUpdateEvents(): Promise<void> {
    while (updatesQueue.length > 0) {
      const event = updatesQueue.shift()!;
      try {
        if (event.entity === 'message') {
          applyMessageEvent(event);
        } else if (event.entity === 'sending') {
          applySendingEvent(event);
          if (event.event === 'complete') {
            $bus.$emitter.emit('sending-complete', { id: event.id, status: event.status });
          }
        } else if (event.entity === 'app-state') {
          applyAppState(event.state);
        } else if (event.entity === 'folder') {
          await loadFolders();
        } else if (event.entity === 'sync') {
          applySyncActivity(event.view);
        } else if (event.entity === 'backup') {
          onBackupProgress(event.progress);
        } else if (event.entity === 'restore') {
          onRestoreProgress(event.progress);
        } else if (event.entity === 'lists') {
          // More changed than was worth reporting one by one - the backend's
          // start-up replay of a backlog of synchronization phantoms. Re-read
          // rather than patch: that replay is the whole history of every message
          // it touched.
          await getMessages();
          await loadFolders();
        }
      } catch (err) {
        log.error('Failed to apply inbox update event', err);
      }
    }
  }

  async function appExit() {
    w3n.closeSelf!();
  }

  function openManageBlocksDialog() {
    $dialogs.$openDialog<void>(ManageBlocksDialog, {
      isMobileMode: isMobileMode.value,
      dialogProps: {
        title: t('manageBlocks.dialog.title'),
        icon: { icon: 'settings-account-box', color: 'var(--warning-content-default)' },
        confirmButton: false,
        cancelButton: false,
      },
    });
  }

  async function runMenuAction(action: AppMenuAction) {
    switch (action) {
      case 'refresh':
        return forceRefreshData();
      case 'manage-blocks':
        return openManageBlocksDialog();
      case 'make-backup':
        return startBackupWorkflow();
      case 'restore-backup':
        return void await runRestoreWorkflow();
      case 'exit':
        return appExit();
      default:
        return undefined;
    }
  }

  async function openCreateMsgDialog(payload: {
    data?: PreparedMessageData;
    isThisReplyOrForward?: boolean;
    sourceFolder?: string;
  }) {
    if (isMobileMode.value) {
      await router.push({
        name: 'message',
        params: { msgId: payload.data?.id },
        query: {
          props: JSON.stringify({
            data: payload.data,
            ...(payload.isThisReplyOrForward && { isThisReplyOrForward: payload.isThisReplyOrForward }),
          }),
          ...(payload.sourceFolder && { sourceFolder: payload.sourceFolder }),
        },
      });
    } else {
      const res = await $dialogs.$openDialog<
        { msgData: PreparedMessageData; withoutSave?: boolean },
        Ui3nDialogEvent<'send'>
      >(CreateMsgDialog, {
        data: payload.data || ({} as PreparedMessageData),
        isThisReplyOrForward: payload.isThisReplyOrForward,
        dialogProps: {
          width: 560,
          cssStyle: {
            height: '90dvh',
          },
          title: t('msg.create.dialog.title'),
          icon: {
            icon: 'round-mail',
            color: 'var(--color-icon-block-accent-default)',
          },
          confirmButton: false,
          cancelButton: false,
          closeOnClickOverlay: false,
          closeOnEsc: true,
        },
      });

      switch (res.event) {
        case 'send': {
          if (res.data?.msgData && !res.data?.withoutSave) {
            await saveMsgToDraft(res.data.msgData!);
          }
          break;
        }

        case 'cancel': {
          if (res.data && res.data.msgData.id) {
            await deleteMessages([res.data.msgData.id]);
          }
          break;
        }
      }
    }
  }

  async function handleExternalCommand({ cmd, params }: web3n.shell.commands.CmdParams) {
    if (cmd === 'open-inbox-with') {
      const cmdArg = params[0] as { peerAddress?: unknown };
      const address = cmdArg?.peerAddress;
      if (!address || typeof address !== 'string') {
        await w3n.log('error', 'Invalid peer address passed in open inbox command');
        return;
      }

      await openCreateMsgDialog({
        data: {
          id: getRandomId(32),
          threadId: getRandomId(32),
          recipients: [address],
          subject: '',
          attachmentsInfo: [],
          htmlTxtBody: '',
        },
      });
      return;
    }

    if (cmd === 'open-inbox-msg') {
      const cmdArg = params[0] as { msgId?: unknown };
      const msgId = cmdArg?.msgId;
      if (!msgId || typeof msgId !== 'string') {
        await w3n.log('error', 'Invalid msgId passed in open inbox message command');
        return;
      }

      if (isMobileMode.value) {
        await router.push({ name: 'message', params: { msgId } });
      } else {
        await router.push('/home/inbox');
        $bus.$emitter.emit('open-inbox-msg', { msgId });
      }
    }
  }

  function startupTextOf(event: StartupEvent): string {
    if (event.stage === 'migrating-files') {
      return t('app.startup.migrating-files', { done: event.done ?? 0, total: event.total ?? 0 });
    }
    if (event.stage === 'ready') {
      return t('app.startup.loading');
    }
    return t(`app.startup.${event.stage}`);
  }

  onBeforeMount(async () => {
    // Phase timings, reported as one line once the page has its data. Same
    // purpose as the one the background component logs: this is where a
    // regression in how long the window takes to fill up shows itself.
    const startedAt = Date.now();
    const phases: string[] = [];
    let phaseStartedAt = startedAt;
    const phaseDone = (name: string) => {
      const now = Date.now();
      phases.push(`${name} ${now - phaseStartedAt}ms`);
      phaseStartedAt = now;
    };

    try {
      mobileMode && setMobileMode(true);

      // Before the first call that waits on the background component: until it
      // has finished starting, every other method of the service is queued
      // behind that, and this is the only one that answers meanwhile.
      setCommonLoading(true);
      startupStatusText.value = t('app.startup.starting');
      unsubStartup.value = inboxSrv.watchStartup({
        next: event => {
          startupStatusText.value = startupTextOf(event);
        },
        error: err => log.error('Error occurred in observation of the app startup.', err),
      });

      // Before the lists are read, not after. The backend answers requests from
      // the moment its service is built, which is BEFORE it replays the backlog
      // of synchronization phantoms - so a read of the lists lands in the middle
      // of that replay, and anything applied between the read and a later
      // subscription used to be invisible until the next change to the same
      // message. Events queue up here and wait for the read to finish.
      unsubWatch.value = inboxSrv.watch({
        next: updateEvent => {
          updatesQueue.push(updateEvent);
          drainUpdatesIfReady();
        },
        complete: () => log.info('Observation of inbox updates completed.'),
        error: err => log.error('Error occurred in observation of inbox updates.', err),
      });

      await Promise.all([
        getAppState(),
        getAppVersion(),
        getUser(),
        readAndStartWatchingAppConfig(),
        getConnectivityStatus(),
        // Asked for as well as subscribed to: the catch-up scan often finishes
        // before this page can subscribe, and a state nobody asked for would
        // then be missed entirely.
        getSyncActivityState().catch(err => log.error('Failed to read the sync state', err)),
      ]);
      phaseDone('app-data');
      // The blacklist BEFORE the message list is drawn, and from the backend:
      // it answers at once, while the contacts app takes the same 13 s as below.
      // Without it, mail from a blocked sender would briefly show no lock and a
      // live Reply button.
      await primeBlacklistFromBackend().catch(err =>
        log.error('Failed to prime the blacklist', err));
      // Reaching the contacts app can take up to 13 s of retries when it is not
      // running, and nothing below needs it: names show as addresses until it
      // answers. See contactsSrv() in initializationServices.
      getContactList().catch(err => log.error('Failed to get the contact list', err));
      fetchBlacklist()
        .then(() => startBlacklistWatch())
        .catch(err => log.error('Failed to read the contact blacklist', err));
      await loadFolders();
      phaseDone('folders');
      await getMessages();
      phaseDone('messages');

      // Whatever arrived while the lists were being read is applied now, on top
      // of them rather than under them.
      initialLoadDone = true;
      drainUpdatesIfReady();

      setCommonLoading(false);
      startupStatusText.value = '';
      log.info(`page filled in ${Date.now() - startedAt}ms: ${phases.join(', ')}`);

      connectivityTimerId.value = setInterval(getConnectivityStatus, 60000);

      $bus.$emitter.on('run-create-message', openCreateMsgDialog);

      const startCmd = await w3n.shell!.getStartedCmd!();
      if (startCmd) {
        handleExternalCommand(startCmd);
      }

      unsub.value = w3n.shell!.watchStartCmds!({
        next: ({ cmd, params }: web3n.shell.commands.CmdParams) => handleExternalCommand({ cmd, params }),
        error: err => console.error(`Error in listening to commands for inbox app:`, err),
        complete: () => console.log(`Listening to commands for inbox app is closed by platform side.`),
      });
    } catch (e) {
      // Otherwise the overlay keeps spinning over an app that will not load.
      setCommonLoading(false);
      startupStatusText.value = '';
      console.error('# APP MOUNTED ERROR => ', e);
      throw e;
    }
  });

  onBeforeUnmount(() => {
    if (connectivityTimerId.value) {
      clearInterval(connectivityTimerId.value);
    }

    unsub.value && unsub.value();
    unsubWatch.value && unsubWatch.value();
    unsubStartup.value && unsubStartup.value();
    stopBlacklistWatch();
    stopWatchingAppConfig();

    $bus.$emitter.off('run-create-message', openCreateMsgDialog);
  });

  return {
    t,
    $bus,
    appVersion,
    me,
    customLogoSrc,
    commonLoading,
    startupStatusText,
    connectivityStatusText,
    /** Whether to show the synchronization line at all. */
    isSyncVisible: computed(() => syncActivity.value.syncing || syncActivity.value.stalled),
    /** Whether the progress bar moves - stuck work is by definition not in progress. */
    isSyncing: computed(() => syncActivity.value.syncing),
    syncStalled: computed(() => syncActivity.value.stalled),
    syncText: computed(() => {
      const { syncing, stalled, pending } = syncActivity.value;
      if (stalled) {
        return t('app.sync.stalled');
      }
      if (!syncing) {
        return '';
      }
      return pending > 1 ? t('app.sync.syncing_count', { count: pending }) : t('app.sync.syncing');
    }),
    appExit,
    setAppWindowSize,
    /**
     * What the avatar menu asks for, on both form factors. One switch rather
     * than one exported callback per item: the desktop menu and the phone drawer
     * are built from one list (see useAppMenuItems), and this is the other half
     * of that - an item added there has exactly one place to be handled.
     */
    runMenuAction,
  };
}
