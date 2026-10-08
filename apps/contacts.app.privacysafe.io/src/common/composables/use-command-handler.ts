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
import { useRouter } from 'vue-router';
import { NEW_POPULATED_CONTACT_ID } from '../constants';
import { useContactsStore } from '../store/contacts.store';
import { storeToRefs } from 'pinia';

export function useCommandHandler() {

  const { contactDataFromCmd } = storeToRefs(useContactsStore());

  const router = useRouter();

  interface OpenContactCmdArg {
    mail: string;
    name?: string;
  }

  async function addNewContact(cmdArg: OpenContactCmdArg) {
    contactDataFromCmd.value = { id: NEW_POPULATED_CONTACT_ID, timestamp: Date.now(), ...cmdArg };
    await router.push({ name: 'contacts' });
    setTimeout(() => router.push({
      name: 'contact',
      params: { id: NEW_POPULATED_CONTACT_ID },
      query: { editMode: 'on' }
    }), 250);
  }

  async function process({ cmd, params }: web3n.shell.commands.CmdParams): Promise<void> {
    try {
      switch (cmd) {
        case 'add-contact':
          return addNewContact(params[0]);
        default:
          w3n.log('error', `🫤 Unknown/unimplemented command ${cmd}`);
          break;
      }
    } catch (err) {
      w3n.log('error', `Error occurred while handing command`, err);
    }
  }

  async function start(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const unsub = w3n.shell!.watchStartCmds!({
      next: cmdParams => {
        process(cmdParams);
      },
      error: err => w3n.log('error', `Error in listening to commands for contacts app:`, err),
      complete: () => console.info(`Listening to commands for contacts app is closed by platform side.`),
    });

    const startCmd = await w3n.shell!.getStartedCmd!();
    if (startCmd) {
      await process(startCmd);
    }
  }

  return { start };
}
