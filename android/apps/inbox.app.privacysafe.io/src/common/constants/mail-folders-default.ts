import type { MailFolder } from '../types/mail.types';

export enum SYSTEM_FOLDERS {
  inbox = '0',
  draft = '1',
  outbox = '2',
  sent = '3',
  trash = '4',
}

export const MAIL_FOLDERS_DEFAULT: MailFolder[] = [
  {
    id: SYSTEM_FOLDERS.inbox,
    name: 'Inbox',
    icon: 'round-mail',
    iconColor: 'var(--color-icon-control-secondary-default)',
    path: 'inbox',
    isSystem: true,
    position: 0,
  },
  {
    id: SYSTEM_FOLDERS.sent,
    name: 'Sent',
    icon: 'round-arrow-upward',
    iconColor: 'var(--color-icon-control-secondary-default)',
    path: 'sent',
    isSystem: true,
    position: 1,
  },
  {
    id: SYSTEM_FOLDERS.outbox,
    name: 'Outbox',
    icon: 'schedule',
    iconColor: 'var(--color-icon-control-secondary-default)',
    path: 'outbox',
    isSystem: true,
    position: 2,
  },
  {
    id: SYSTEM_FOLDERS.draft,
    name: 'Draft',
    icon: 'stylus',
    iconColor: 'var(--color-icon-control-secondary-default)',
    path: 'draft',
    isSystem: true,
    position: 3,
  },
  {
    id: SYSTEM_FOLDERS.trash,
    name: 'Trash',
    icon: 'trash-can',
    iconColor: 'var(--color-icon-control-secondary-default)',
    path: 'trash',
    isSystem: true,
    position: 4,
  },
];
