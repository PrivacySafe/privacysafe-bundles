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
import type { Nullable } from '@v1nt1248/3nclient-lib';

type DeliveryRecipient = web3n.asmail.DeliveryProgress['recipients'][string];

function hasFlag(err: object, flag: string): boolean {
  return Object.prototype.hasOwnProperty.call(err, flag);
}

export function handleSendingError(errorInfo: DeliveryRecipient): Nullable<string> {
  if (!errorInfo?.err) {
    return null;
  }

  const { err = {} } = errorInfo;

  if (hasFlag(err, 'domainNotFound')) {return 'domainNotFound';}
  if (hasFlag(err, 'unknownRecipient')) {return 'unknownRecipient';}
  if (hasFlag(err, 'senderNotAllowed')) {return 'senderNotAllowed';}
  if (hasFlag(err, 'inboxIsFull')) {return 'inboxIsFull';}
  if (hasFlag(err, 'badRedirect')) {return 'badRedirect';}
  if (hasFlag(err, 'authFailedOnDelivery')) {return 'authFailedOnDelivery';}
  if (hasFlag(err, 'msgTooBig')) {return 'msgTooBig';}
  if (hasFlag(err, 'allowedSize')) {return 'allowedSize';}
  if (hasFlag(err, 'recipientPubKeyFailsValidation')) {return 'recipientPubKeyFailsValidation';}
  if (hasFlag(err, 'recipientHasNoPubKey')) {return 'recipientHasNoPubKey';}
  if (hasFlag(err, 'msgNotFound')) {return 'msgNotFound';}
  if (hasFlag(err, 'msgCancelled')) {return 'msgCancelled';}

  return '';
}
