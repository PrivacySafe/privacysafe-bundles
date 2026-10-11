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
// Validation of the contact's mail address, lifted out of useContact so it can
// be exercised without a component, a store or an i18n instance.
/**
 * Whole-string address check.
 *
 * The shared library's mailReg is /[^@]+@[^@]+\.[^@]+/iu — no ^ or $ — so it
 * answers "does this CONTAIN something address-shaped", and
 * 'hello ann@3nweb.com world' passed validation. This one is anchored, and also
 * refuses leading or trailing whitespace: toCanonicalAddress strips whitespace
 * from the user part only, so a stray space in the domain silently makes a
 * different address.
 *
 * Whitespace INSIDE the user part stays legal — 3NWeb's own accounts are named
 * that way, e.g. 'contacts app tester 1@3nweb.com'. Which characters a user part
 * may otherwise contain is not decided here: no such rule is documented, and
 * guessing one would reject legitimate addresses.
 */
const mailAddress = /^[^@\s][^@]*@[^@\s.]+(\.[^@\s.]+)+$/u;

/** true when valid, otherwise the message to show. */
export type ValidationResult = boolean | string;

export type Translate = (key: string) => string;

export interface MailRulesDeps {
  t: Translate;
  isMailAddressInUse: (mail: string, ignoredMailAddresses?: string[]) => boolean;
  /** Addresses that do not count as "taken" — the contact's own, when editing. */
  ignoredAddresses: () => string[];
}

export function checkRequired(value: unknown, t: Translate): ValidationResult {
  return !!value || t('validation.text.required');
}

export function checkEmail(value: unknown, t: Translate): ValidationResult {
  return mailAddress.test(value as string) || t('validation.text.mail');
}

export function checkUsage(
  value: unknown, t: Translate,
  isMailAddressInUse: MailRulesDeps['isMailAddressInUse'],
  ignoredAddresses: string[],
): ValidationResult {
  return isMailAddressInUse(value as string, ignoredAddresses)
    ? t('validation.text.usage')
    : true;
}

/** The rule list handed to the address field, in the order it is evaluated. */
export function makeMailRules(
  deps: MailRulesDeps,
): ((value?: unknown) => ValidationResult)[] {
  return [
    value => checkRequired(value, deps.t),
    value => checkEmail(value, deps.t),
    value => checkUsage(value, deps.t, deps.isMailAddressInUse, deps.ignoredAddresses()),
  ];
}
