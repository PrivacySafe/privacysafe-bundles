/*
 Copyright (C) 2020 - 2025 3NSoft Inc.

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

import type { ChatMenuItem, ChatMessageAction, MessageDeliveryStatusUI, OutgoingMessageStatus } from '~/index';

export const chatMsgActionElementHeight = 32;

export const messageDeliveryStatuses: Record<OutgoingMessageStatus, MessageDeliveryStatusUI> = {
  ready_to_send: {
    icon: 'round-rotate-right',
    color: 'var(--color-icon-chat-bubble-user-quote)',
  },
  sending: {
    icon: 'round-refresh',
    color: 'var(--color-icon-chat-bubble-user-quote)',
  },
  syncing_self: {
    icon: 'round-refresh',
    color: 'var(--color-icon-chat-bubble-user-quote)',
  },
  sent: {
    icon: 'round-check',
    color: 'var(--success-content-default)',
  },
  error: {
    icon: 'round-report-gmailerrorred',
    color: 'var(--error-content-default)',
  },
  canceled: {
    icon: 'round-cancel-schedule-send',
    color: 'var(--warning-content-default)',
  },
  read: {
    icon: 'round-done-all',
    color: 'var(--success-content-default)',
  },
};

export const chatMenuItems: ChatMenuItem[] = [
  {
    icon: 'outline-info',
    action: 'chat:info',
    text: 'chat.action.menu.txt.info',
    chatTypes: ['single', 'group'],
  },
  {
    icon: 'round-refresh',
    action: 'chat:refresh',
    text: 'chat.action.menu.txt.refresh',
    chatTypes: ['single', 'group'],
    disable: ['blocked-chat'],
  },
  {
    icon: 'outline-timer',
    action: 'chat:timer',
    text: 'chat.action.menu.txt.timer.label',
    chatTypes: ['single', 'group&admin'],
    disable: ['chat-with-call'],
    subMenu: [
      {
        icon: '',
        action: 'chat:timer:0',
        text: 'chat.action.menu.txt.timer.0',
        chatTypes: ['single', 'group&admin'],
      },
      {
        icon: '',
        action: 'chat:timer:1',
        text: 'chat.action.menu.txt.timer.1',
        chatTypes: ['single', 'group&admin'],
      },
      {
        icon: '',
        action: 'chat:timer:2',
        text: 'chat.action.menu.txt.timer.2',
        chatTypes: ['single', 'group&admin'],
      },
      {
        icon: '',
        action: 'chat:timer:3',
        text: 'chat.action.menu.txt.timer.3',
        chatTypes: ['single', 'group&admin'],
      },
      {
        icon: '',
        action: 'chat:timer:4',
        text: 'chat.action.menu.txt.timer.4',
        chatTypes: ['single', 'group&admin'],
      },
      {
        icon: '',
        action: 'chat:timer:5',
        text: 'chat.action.menu.txt.timer.5',
        chatTypes: ['single', 'group&admin'],
      },
    ],
  },
  {
    icon: 'outline-edit',
    action: 'chat:rename',
    text: 'chat.action.menu.txt.rename',
    disable: ['chat-with-call'],
    chatTypes: ['group&admin'],
  },
  {
    icon: 'round-system-update-alt',
    action: 'history:export',
    text: 'chat.action.menu.txt.history.export',
    chatTypes: ['single', 'group'],
  },
  {
    icon: 'outline-cleaning-services',
    action: 'history:clean',
    text: 'chat.action.menu.txt.history.clean',
    chatTypes: ['single', 'group'],
    disable: ['chat-with-call'],
  },
  {
    icon: 'round-close',
    action: 'chat:close',
    text: 'chat.action.menu.txt.close',
    chatTypes: ['single', 'group'],
    disable: ['chat-with-call'],
  },
  {
    icon: 'outline-account-off-circle',
    action: 'contact:block',
    text: 'chat.action.menu.txt.block',
    chatTypes: ['single'],
    isAccent: true,
    margin: true,
    disable: ['chat-with-call'],
  },
  {
    icon: 'outline-account-circle',
    action: 'contact:unblock',
    text: 'chat.action.menu.txt.unblock',
    chatTypes: ['single'],
    isAccent: true,
    margin: true,
    disable: ['chat-with-call'],
  },
  {
    icon: 'settings-account-box',
    action: 'contact:manage-blocks',
    text: 'chat.action.menu.txt.manage_blocks',
    chatTypes: ['group'],
    isAccent: true,
    margin: true,
    disable: ['chat-with-call'],
  },
  {
    icon: 'outline-delete',
    action: 'chat:delete',
    text: 'chat.action.menu.txt.leave',
    chatTypes: ['single', 'group'],
    isAccent: true,
    margin: true,
    disable: ['chat-with-call'],
  },
];

/*
 * condition - {part1}:{part2}:{part3}
 * part1 (message type): 'incoming'|'outgoing' OR '' (if it does not matter)
 * part2 (message delivery status): lists the MessageStatus separated by commas OR '' (if it does not matter)
 * part3 (attachments):  true OR false OR '' (if it does not matter)
 * part4 (lifetime): '' if it does not matter OR a string like '>1000' or '<1000' ('>' or '<' is the comparison
 *  condition and then the value in ms
 * */
export const messageActions: ChatMessageAction[] = [
  {
    id: 'reaction',
    icon: { name: 'outline-heart-plus' },
    title: 'chat.message.menu.reaction',
    conditions: [':sent,read::'],
  },
  {
    id: 'reply',
    icon: { name: 'outline-reply' },
    title: 'chat.message.menu.reply',
    conditions: ['incoming:sent,read::'],
  },
  {
    id: 'copy',
    icon: { name: 'round-content-copy' },
    title: 'chat.message.menu.copy',
    conditions: ['incoming:::', 'outgoing:sent,read,error,canceled::'],
    allowInReadonlyMode: true,
  },
  {
    id: 'forward',
    icon: { name: 'outline-forward' },
    title: 'chat.message.menu.forward',
    conditions: ['incoming:::', 'outgoing:sent,read,error,canceled::'],
  },
  {
    id: 'edit',
    icon: { name: 'outline-edit' },
    title: 'chat.message.menu.edit',
    conditions: ['outgoing:sent,read,error,canceled::<86400000'],
  },
  {
    id: 'download',
    icon: { name: 'outline-download-for-offline' },
    title: 'chat.message.menu.download',
    conditions: ['incoming::true:', 'outgoing:sent,read,error,canceled:true:'],
    allowInReadonlyMode: true,
  },
  {
    id: 'resend',
    icon: { name: 'round-refresh' },
    title: 'chat.message.menu.resend',
    conditions: ['outgoing:error::', 'outgoing:canceled::'],
  },
  {
    id: 'select',
    icon: { name: 'round-check-circle-outline' },
    title: 'chat.message.menu.select',
    conditions: [':::'],
    allowInReadonlyMode: true,
  },
  {
    id: 'info',
    icon: { name: 'outline-info', rotateIcon: 2 },
    title: 'chat.message.menu.info',
    conditions: [':::'],
    allowInReadonlyMode: true,
  },
  {
    id: 'delete_message',
    icon: { name: 'outline-delete' },
    title: 'chat.message.menu.delete_message',
    conditions: ['incoming:::', 'outgoing:sent,read,error,canceled::'],
    allowInReadonlyMode: true,
    blockStart: true,
    accent: 'var(--warning-content-default)',
  },
  {
    id: 'cancel_sending',
    icon: { name: 'round-cancel-schedule-send' },
    title: 'chat.message.menu.cancel_sending',
    conditions: ['outgoing:sending::'],
    allowInReadonlyMode: true,
    blockStart: true,
    accent: 'var(--warning-content-default)',
  },
];

export const validationParams = {
  chatsNameMaxLength: 50,
};

export const FILE_TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  doc: {
    bg: 'var(--files-word-secondary)',
    color: 'var(--files-word-primary)',
  },
  docx: {
    bg: 'var(--files-word-secondary)',
    color: 'var(--files-word-primary)',
  },
  xls: {
    bg: 'var(--files-excel-secondary)',
    color: 'var(--files-excel-primary)',
  },
  xlsx: {
    bg: 'var(--files-excel-secondary)',
    color: 'var(--files-excel-primary)',
  },
  pdf: {
    bg: 'var(--files-pdf-secondary)',
    color: 'var(--files-pdf-primary)',
  },
  jpg: {
    bg: 'var(--files-image-secondary)',
    color: 'var(--files-image-primary)',
  },
  jpeg: {
    bg: 'var(--files-image-secondary)',
    color: 'var(--files-image-primary)',
  },
  png: {
    bg: 'var(--files-image-secondary)',
    color: 'var(--files-image-primary)',
  },
  gif: {
    bg: 'var(--files-image-secondary)',
    color: 'var(--files-image-primary)',
  },
  tiff: {
    bg: 'var(--files-image-secondary)',
    color: 'var(--files-image-primary)',
  },
  webp: {
    bg: 'var(--files-image-secondary)',
    color: 'var(--files-image-primary)',
  },
  svg: {
    bg: 'var(--files-image-secondary)',
    color: 'var(--files-image-primary)',
  },
  ico: {
    bg: 'var(--files-image-secondary)',
    color: 'var(--files-image-primary)',
  },
};

export const FILE_TYPE_COLOR_DEFAULT = {
  bg: 'var(--color-bg-control-secondary-pressed)',
  color: 'var(--color-text-control-primary-default)',
};
