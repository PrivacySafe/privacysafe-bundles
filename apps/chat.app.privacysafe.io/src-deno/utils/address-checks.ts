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

/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  ASMailSendException,
  ServLocException,
  ConnectException,
} from '../../types';
import type { AddressCheckResult } from '../../types/services.types.ts';

/**
 * Checks if an address exists and is reachable via ASMail delivery system.
 * Uses preFlight check to verify address existence without sending a message.
 * 
 * @param addr - The address to check
 * @returns AddressCheckResult indicating the status of the address
 * @throws ConnectException if connection fails
 * @throws ASMailSendException for other delivery-related errors
 */
export async function checkAddressExistenceForASMail(addr: string): Promise<AddressCheckResult> {
  try {
    await w3n.mail!.delivery.preFlight(addr);
    return 'found';
  } catch (err) {
    if ((err as ASMailSendException).type === 'asmail-delivery') {
      const exc = err as ASMailSendException;

      if (exc.unknownRecipient) {
        return 'not-present-at-domain';
      }

      if (exc.inboxIsFull) {
        return 'found';
      }

      if (exc.senderNotAllowed) {
        return 'found-but-access-restricted';
      }

      if (exc.recipientPubKeyFailsValidation) {
        return 'not-valid-public-key';
      }

      throw exc;
    }

    if ((err as ConnectException).type === 'connect') {
      throw err;
    }

    if ((err as ServLocException).type === 'service-locating') {
      return 'no-service-for-domain';
    }

    throw err;
  }
}

/**
 * Ensures all given addresses exist and are reachable via ASMail.
 * Performs parallel checks for all addresses.
 * 
 * @param members - Record of addresses with their acceptance status
 * @returns Object with status 'success' if all addresses are valid,
 *          or 'error' with details about failed addresses
 */
export async function ensureAllAddressesExist(members: Record<string, { hasAccepted: boolean }>): Promise<{
  status: 'success' | 'error';
  errorData?: {
    addr: string;
    check: AddressCheckResult | undefined;
    exc: any;
  }[];
}> {
  const checks = await Promise.all(Object.keys(members).map(async addr => {
    const { check, exc } = await checkAddressExistenceForASMail(addr).then(
      check => ({ check, exc: undefined }),
      exc => ({ check: undefined, exc }),
    );
    return { addr, check, exc };
  }));

  const failedAddresses = checks.filter(({ check }) => (check !== 'found'));

  return {
    status: failedAddresses.length ? 'error' : 'success',
    ...(failedAddresses.length && { errorData: failedAddresses }),
  };
}