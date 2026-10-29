import { inject, ref } from 'vue';
import { NOTIFICATIONS_KEY, NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import { inboxSrv } from '@common/services/services-provider';
import { attachmentAvailabilityOf } from '@shared/utils/attachment-availability';
import type { AttachmentInfo } from '@common/types';

interface AttachmentMount {
  fs: web3n.files.ReadonlyFS;
  revision: number;
}

// Shared by attachment cards in this GUI. Map insertion order is mount order:
// reusing a message's mount must not move it behind more recently mounted ones.
// This tracks the current GUI session; the API cannot enumerate older mounts.
const attachmentMounts = new Map<string, AttachmentMount>();
const MAX_ATTACHMENT_MOUNTS = 8;
let attachmentMountRevision = 0;
let attachmentMountQueue: Promise<void> = Promise.resolve();
let pendingAttachmentMount: Promise<void> | undefined;
const openingFiles = new Map<string, { startedAt: number }>();
const preparingFiles = ref<Record<string, boolean>>({});
const DUPLICATE_OPEN_INTERVAL_MS = 1_000;
const ATTACHMENT_PREPARATION_TIMEOUT_MS = 30_000;
const ATTACHMENT_OPEN_TIMEOUT_MS = 15_000;

class AttachmentOpenTimeoutError extends Error {
  readonly stage: 'preparing' | 'mounting' | 'opening';

  constructor(stage: 'preparing' | 'mounting' | 'opening') {
    super(`Attachment ${stage} timed out`);
    this.name = 'AttachmentOpenTimeoutError';
    this.stage = stage;
  }
}

async function withAttachmentTimeout<T>(
  pending: Promise<T>,
  timeoutMs: number,
  stage: AttachmentOpenTimeoutError['stage'],
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AttachmentOpenTimeoutError(stage)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Timing out does not cancel a platform mutation. Keep it tracked until its
// real result arrives, and commit that result even if the request has expired.
// The queue can then fail fast instead of starting overlapping mount changes.
async function changeAttachmentMount(change: () => Promise<void>, onChanged: () => void): Promise<void> {
  if (pendingAttachmentMount) {
    throw new AttachmentOpenTimeoutError('mounting');
  }
  const pending = Promise.resolve()
    .then(change)
    .then(onChanged)
    .finally(() => {
      if (pendingAttachmentMount === pending) {
        pendingAttachmentMount = undefined;
      }
    });
  pendingAttachmentMount = pending;
  await withAttachmentTimeout(pending, ATTACHMENT_PREPARATION_TIMEOUT_MS, 'mounting');
}

function attachmentKey(msgId: string, fileName: string): string {
  return JSON.stringify([msgId, fileName]);
}

function isMountException(error: unknown, flag: 'alreadyMounted' | 'notMounted'): boolean {
  const exc = error as web3n.shell.mounts.MountException | null | undefined;
  return exc?.type === 'mount' && exc[flag] === true;
}

// Called only from attachmentMountQueue, including the notMounted retry.
async function ensureMounted(
  msgId: string,
  mounts: web3n.shell.mounts.MountsIntoOS,
  isCurrentRequest: () => boolean,
): Promise<AttachmentMount | undefined> {
  const existing = attachmentMounts.get(msgId);
  if (existing) {
    return existing;
  }

  // Fetch before evicting, so a missing message does not discard a useful mount.
  const fs = await withAttachmentTimeout(
    inboxSrv.getIncomingAttachmentsFS(msgId),
    ATTACHMENT_PREPARATION_TIMEOUT_MS,
    'preparing',
  );
  if (!isCurrentRequest()) {
    return;
  }
  if (!fs) {
    throw new Error(`Message '${msgId}' has no readable attachment filesystem`);
  }

  while (attachmentMounts.size >= MAX_ATTACHMENT_MOUNTS) {
    const oldest = attachmentMounts.entries().next().value;
    if (!oldest) {
      throw new Error('Unable to find the oldest attachment mount');
    }
    const [oldestMsgId, oldestMount] = oldest;
    await changeAttachmentMount(
      async () => {
        try {
          await mounts.unmountFolder(oldestMount.fs);
        } catch (error) {
          if (!isMountException(error, 'notMounted')) {
            throw error;
          }
        }
      },
      () => {
        // Drop the reference only after confirmed unmount, including a late reply.
        attachmentMounts.delete(oldestMsgId);
      },
    );
    if (!isCurrentRequest()) {
      return;
    }
  }

  await changeAttachmentMount(
    async () => {
      try {
        // Prefix and encode the opaque message id into ONE safe path segment.
        // Identical filenames in different messages must never share a mount.
        await mounts.mountFolder(['Inbox', `msg-${encodeURIComponent(msgId)}`], fs);
      } catch (error) {
        if (!isMountException(error, 'alreadyMounted')) {
          throw error;
        }
      }
    },
    () => {
      attachmentMounts.set(msgId, { fs, revision: ++attachmentMountRevision });
    },
  );
  return attachmentMounts.get(msgId);
}

function prepareAttachmentOpen({
  msgId,
  pathInFS,
  mounts,
  openInMounted,
  isCurrentRequest,
  onPrepared,
  missingRevision,
}: {
  msgId: string;
  pathInFS: string[];
  mounts: web3n.shell.mounts.MountsIntoOS;
  openInMounted: web3n.shell.OpenInMountedFolder;
  isCurrentRequest: () => boolean;
  onPrepared: () => void;
  missingRevision?: number;
}): Promise<{ result: Promise<void>; revision: number } | undefined> {
  const pending = attachmentMountQueue.then(async () => {
    if (!isCurrentRequest()) {
      return;
    }
    // A timed-out mount/unmount may still be running in the platform. Do not
    // invalidate tracking or dispatch more work until its actual reply arrives.
    if (pendingAttachmentMount) {
      throw new AttachmentOpenTimeoutError('mounting');
    }
    // A delayed notMounted reply must not invalidate a newer mount.
    if (missingRevision !== undefined && attachmentMounts.get(msgId)?.revision === missingRevision) {
      attachmentMounts.delete(msgId);
    }
    const state = await ensureMounted(msgId, mounts, isCurrentRequest);
    if (!state || !isCurrentRequest()) {
      return;
    }
    onPrepared();
    const result = openInMounted(state.fs, pathInFS);
    // Handle immediate rejection while the queue hands the promise to its caller.
    void result.catch(() => {});
    // Dispatch inside the queue, but do not await the external application's
    // promise here. Pending shell replies must not block subsequent requests.
    // Return only the revision, so the waiting caller does not retain the FS.
    return { result, revision: state.revision };
  });
  attachmentMountQueue = pending.then(
    () => {},
    () => {},
  );
  return pending;
}

export function useOpenAttachments({ t }: { t: (txt: string, placeholder?: Record<string, string>) => string }) {
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  function isOpenAvailable(): boolean {
    return !!w3n.shell?.mounts && typeof w3n.shell?.openInMounted === 'function';
  }

  function isPreparingAttachment(msgId: string, fileName: string): boolean {
    return !!preparingFiles.value[attachmentKey(msgId, fileName)];
  }

  async function openAttachment({
    msgId,
    isIncomingMessage,
    attachment,
  }: {
    msgId: string;
    isIncomingMessage: boolean;
    attachment: AttachmentInfo;
  }): Promise<void> {
    // Receive current message details at click time, rather than retaining the
    // message that happened to be displayed when the composable was created.
    if (!isIncomingMessage) {
      return;
    }

    const { fileName } = attachment;
    if (attachmentAvailabilityOf(attachment, msgId) === 'on-another-device') {
      $createNotice({
        type: 'error',
        content: t('msg.attachment.on_another_device', { fileName }),
      });
      return;
    }

    const shell = w3n.shell;
    const mounts = shell?.mounts;
    if (!mounts || !shell?.openInMounted) {
      $createNotice({ type: 'error', content: t('msg.attachment.opening.unavailable') });
      return;
    }

    const key = attachmentKey(msgId, fileName);
    const previous = openingFiles.get(key);
    if (previous && Date.now() - previous.startedAt < DUPLICATE_OPEN_INTERVAL_MS) {
      return;
    }
    const request = { startedAt: Date.now() };
    openingFiles.set(key, request);
    preparingFiles.value[key] = true;
    let requestActive = true;
    const isCurrentRequest = () => requestActive && openingFiles.get(key) === request;

    try {
      const pathInFS = fileName.split('/');
      if (
        !msgId ||
        pathInFS.some(
          part => !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\u0000'),
        )
      ) {
        throw new Error('Invalid attachment path');
      }
      const prepare = (missingRevision?: number) =>
        withAttachmentTimeout(
          prepareAttachmentOpen({
            msgId,
            pathInFS,
            mounts,
            openInMounted: (fs, path) => shell.openInMounted!(fs, path),
            isCurrentRequest,
            onPrepared: () => {
              preparingFiles.value[key] = false;
            },
            missingRevision,
          }),
          ATTACHMENT_PREPARATION_TIMEOUT_MS,
          'preparing',
        );
      const opened = await prepare();
      if (!opened) {
        return;
      }

      // Bound the shell reply independently of preparation. A timeout cannot
      // tell us whether the OS launched the app, so never retry it automatically.
      try {
        await withAttachmentTimeout(opened.result, ATTACHMENT_OPEN_TIMEOUT_MS, 'opening');
      } catch (error) {
        if (!isCurrentRequest() || !isMountException(error, 'notMounted')) {
          throw error;
        }
        preparingFiles.value[key] = true;
        const reopened = await prepare(opened.revision);
        if (!reopened) {
          return;
        }
        await withAttachmentTimeout(reopened.result, ATTACHMENT_OPEN_TIMEOUT_MS, 'opening');
      }
    } catch (error) {
      if (isCurrentRequest()) {
        if (error instanceof AttachmentOpenTimeoutError && error.stage === 'opening') {
          // The OS may already have opened the file. End this request without
          // claiming success/failure or retrying; finally still clears its state.
          console.info(
            `No shell reply within ${ATTACHMENT_OPEN_TIMEOUT_MS}ms for attachment '${fileName}' ` +
              `of message '${msgId}'; the external application may already have opened it.`,
          );
          return;
        }
        w3n.log('error', `Error opening attachment '${fileName}' of message '${msgId}'`, error);
        let errorKey = 'msg.attachment.opening.error';
        if (error instanceof AttachmentOpenTimeoutError) {
          if (pendingAttachmentMount) {
            errorKey = 'msg.attachment.opening.mount_pending';
          } else {
            errorKey = 'msg.attachment.opening.prepare_timeout';
          }
        }
        $createNotice({
          type: 'error',
          content: t(errorKey, { fileName }),
        });
      }
    } finally {
      if (isCurrentRequest()) {
        delete preparingFiles.value[key];
        // Also suppress the second half of a double click when the shell
        // resolves immediately. Do not retain completed requests indefinitely.
        const remaining = DUPLICATE_OPEN_INTERVAL_MS - (Date.now() - request.startedAt);
        if (remaining > 0) {
          setTimeout(() => {
            if (openingFiles.get(key) === request) {
              openingFiles.delete(key);
            }
          }, remaining);
        } else {
          openingFiles.delete(key);
        }
      }
      // A timed-out preparation may still be queued or awaiting a platform
      // reply. It must never continue to open a file after this request ends.
      requestActive = false;
    }
  }

  return { isOpenAvailable, isPreparingAttachment, openAttachment };
}
