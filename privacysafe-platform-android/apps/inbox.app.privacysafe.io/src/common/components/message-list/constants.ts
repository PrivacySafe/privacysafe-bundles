import { SYSTEM_FOLDERS } from '@common/constants';

export const FOLDER_KEY_BY_ID: Record<string, string> = {
  [SYSTEM_FOLDERS.inbox]: 'inbox',
  [SYSTEM_FOLDERS.draft]: 'draft',
  [SYSTEM_FOLDERS.outbox]: 'outbox',
  [SYSTEM_FOLDERS.sent]: 'sent',
  [SYSTEM_FOLDERS.trash]: 'trash',
};
