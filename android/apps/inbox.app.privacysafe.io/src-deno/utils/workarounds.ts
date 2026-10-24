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
export async function ensureDefaultAnonSenderMaxMsgSize(defaultMsgSize: number): Promise<void> {
  try {
    const anonPolicy = await w3n.mail!.config.getOnServer('anon-sender/policy');
    if (typeof anonPolicy?.defaultMsgSize !== 'number' || anonPolicy.defaultMsgSize < defaultMsgSize) {
      await w3n.mail!.config.setOnServer('anon-sender/policy', {
        accept: !!anonPolicy?.accept,
        acceptWithInvitesOnly: !!anonPolicy?.acceptWithInvitesOnly,
        defaultMsgSize,
      });
    }
  } catch (error) {
    w3n.log('error', `Fail in checking and setting anonymous sender max message size`, error);
  }
}
