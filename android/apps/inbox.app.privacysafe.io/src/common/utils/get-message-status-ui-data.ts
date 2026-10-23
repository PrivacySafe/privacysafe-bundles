/*
 Copyright (C) 2025 3NSoft Inc.

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
import type { IncomingMessageView, OutgoingMessageView } from '@common/types';

export function getMessageStatusUiData({
  message,
  t,
}: {
  message?: IncomingMessageView | OutgoingMessageView;
  t: (txt: string, placeholder?: Record<string, string>) => string;
}) {
  if (!message) {return null;}

  const isIncomingMessage = !!(message as IncomingMessageView).sender;

  if (isIncomingMessage || ['draft', 'sent'].includes(message.status)) {return null;}

  if (message.status === 'canceled') {
    return {
      text: t('msg.sending.label.canceled'),
      color: 'var(--error-content-default)',
    };
  }

  if (message.status === 'error') {
    return {
      text: t('msg.sending.label.error'),
      color: 'var(--error-content-default)',
    };
  }

  if (message.status === 'sending') {
    return {
      text: t('msg.sending.label.progress'),
      color: 'var(--color-text-block-accent-default)',
    };
  }

  return null;
}
