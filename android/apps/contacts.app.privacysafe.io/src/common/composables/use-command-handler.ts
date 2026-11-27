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
import { inject } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  DIALOGS_KEY,
  NOTIFICATIONS_KEY,
  type DialogsPlugin,
  type NotificationsPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import { NEW_POPULATED_CONTACT_ID } from '../constants';
import { checkAndTransformAddress } from '@shared/address-utils';

const MAX_PREFILLED_NAME_LENGTH = 200;
import { useContactsStore } from '../store/contacts.store';
import { storeToRefs } from 'pinia';
import ImportContactsDialog, {
  type ImportContactsResult,
} from '@main/common/components/dialogs/import-contacts-dialog.vue';

export function useCommandHandler() {

  const contactsStore = useContactsStore();
  const { contactDataFromCmd } = storeToRefs(contactsStore);

  const router = useRouter();
  const { t } = useI18n();
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY);
  const notification = inject<NotificationsPlugin>(NOTIFICATIONS_KEY);
  let isImportRunning = false;

  interface OpenContactCmdArg {
    mail: string;
    name?: string;
  }

  /**
   * Prefills the form of a NEW contact from the command, and only that.
   *
   * Any app may start this command. The argument used to be spread over the
   * new contact, so an `id` in it turned the "new contact" form into an edit of
   * an existing one: the user saw an empty Alice, pressed Save, and Alice's
   * address became the caller's (audit of 2026-11-26). Only an address and a
   * one-line name are taken.
   */
  async function addNewContact(cmdArg: OpenContactCmdArg) {
    const mail = checkAndTransformAddress(cmdArg?.mail) ? (cmdArg.mail as string).trim() : '';
    const name = (typeof cmdArg?.name === 'string')
      // eslint-disable-next-line no-control-regex
      ? cmdArg.name.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().substring(0, MAX_PREFILLED_NAME_LENGTH)
      : undefined;
    contactDataFromCmd.value = {
      id: NEW_POPULATED_CONTACT_ID,
      timestamp: Date.now(),
      mail,
      ...(name && { name }),
    };
    await router.push({ name: 'contacts' });
    setTimeout(() => router.push({
      name: 'contact',
      params: { id: NEW_POPULATED_CONTACT_ID },
      query: { editMode: 'on' }
    }), 250);
  }

  /**
   * A click on a reminder of a contact's date (see the date reminders of the
   * service). The contact may have been removed since, in which case the list
   * is all there is to show.
   */
  async function openContact(cmdArg: { contactId?: unknown }) {
    const contactId = cmdArg?.contactId;
    if (!contactId || (typeof contactId !== 'string')) {
      await w3n.log('error', 'Invalid contact id passed in open contact command');
      return;
    }

    const contact = await contactsStore.getContact(contactId).catch(() => undefined);
    if (!contact) {
      await router.push({ name: 'contacts' });
      return;
    }

    await router.push({ name: 'contact', params: { id: contactId } });
  }

  /**
   * Contacts shared by another user: the chat or inbox app has handed the
   * file to the service, and passes here the id under which it was read.
   */
  async function importContacts(cmdArg: { importId?: unknown }) {
    const importId = cmdArg?.importId;
    if (!importId || (typeof importId !== 'string')) {
      await w3n.log('error', 'Invalid import id passed in import contacts command');
      return;
    }
    if (isImportRunning || !dialog) {
      return;
    }

    isImportRunning = true;
    try {
      await router.push({ name: 'contacts' });
      const res = await dialog.$openDialog<ImportContactsResult>(ImportContactsDialog, {
        importId,
        dialogProps: {
          title: t('import.title'),
          hideCloseButton: true,
          confirmButton: false,
          cancelButton: false,
          closeOnClickOverlay: false,
          closeOnEsc: false,
          cssStyle: { width: '640px', maxWidth: '95%' },
        },
      });

      await contactsStore.fetchContacts({});

      const result = res.data;
      if (result?.outcome === 'not-found') {
        // The command is delivered again when the window is re-created, long
        // after its import is done.
        notification?.$createNotice({ type: 'warning', content: t('import.notFound'), duration: 5000 });
      } else if (result) {
        notification?.$createNotice({
          type: (result.outcome === 'done') ? 'success' : 'info',
          content: t('import.result', { ...result.stats }),
          duration: 5000,
        });
      }
    } finally {
      isImportRunning = false;
    }
  }

  async function process({ cmd, params }: web3n.shell.commands.CmdParams): Promise<void> {
    try {
      switch (cmd) {
        case 'add-contact':
          return addNewContact(params[0]);
        case 'open-contact':
          return openContact(params[0]);
        case 'import-contacts':
          // Not awaited: the app's start waits for the start command to be
          // processed, and must not wait for the user going through the import.
          void importContacts(params[0]).catch(err => w3n.log('error', 'Error importing contacts', err));
          return;
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
