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
import { computed, inject, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import cloneDeep from 'lodash/cloneDeep';
import omit from 'lodash/omit';
import pick from 'lodash/pick';
import {
  DIALOGS_KEY,
  DialogsPlugin,
  NOTIFICATIONS_KEY,
  NotificationsPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import {
  generateColor,
  getFileExtension,
  resizeImage,
  schedulerYield,
  sleep,
  transformWeb3nFileToFile,
} from '@v1nt1248/3nclient-lib/utils';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import { appContactsSrvProxy } from '@main/common/services/services-provider';
import { useAppStore } from '@main/common/store/app.store';
import { useContactsStore } from '@main/common/store/contacts.store';
import { useConnectivityStatus } from '@main/common/composables/use-connectivity-status';
import { verdictForAddressCheck } from '@main/common/utils/contact-reachability';
import { makeMailRules } from '@main/common/utils/contact-validation';
import {
  chatApp,
  EMPTY_CONTACT,
  inboxApp,
  isNewContactId,
  NEW_EMPTY_CONTACT_ID,
  NEW_POPULATED_CONTACT_ID,
} from '@main/common/constants';
import { ContactTextField, OpenChatCmdArg, OpenInboxCmdArg, Person, PersonSettings } from '@main/types';
import ConfirmationDialog from '@main/common/components/dialogs/confirmation-dialog.vue';
import OwnKeysInfoDialog from '@main/common/components/dialogs/own-keys-info-dialog.vue';
import ContactKeysInfoDialog from '@main/common/components/dialogs/contact-keys-info-dialog.vue';
import ShareQrDialog from '@main/common/components/dialogs/share-qr-code-dialog.vue';

export function useContact() {
  const route = useRoute();
  const router = useRouter();

  const { t } = useI18n();
  const notification = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY)!;

  const { user } = storeToRefs(useAppStore());
  const contactsStore = useContactsStore();
  const {
    isMailAddressInUse,
    getContact,
    fetchContacts,
    deleteContact,
    upsertContact,
    upsertContactListItem,
    updateContactField,
    changeContactBlockingSettings,
  } = contactsStore;
  const { contactDataFromCmd } = storeToRefs(contactsStore);

  const contentEl = ref<HTMLDivElement | null>(null);
  const isLoading = ref(false);
  const contact = ref<Nullable<Person> | undefined>(null);
  const initialContact = ref<Nullable<Person> | undefined>(null);
  const contactValid = ref(isNewContactId(contact.value?.id));
  const imageProcessing = ref(false);

  const isContactNew = computed(() => isNewContactId(contact.value?.id));
  // XXX can this be a constant?
  const contactIdFromURL = computed(() => route.params.id as string);
  const isUserAddress = computed(() => contact.value?.id === user.value || contact.value?.mail === user.value);

  const { connectivityStatus } = useConnectivityStatus();

  const contactSettings = computed(() => contact.value?.settings || ({} as PersonSettings));

  /**
   * Whether handing this contact to the chat or the inbox app makes sense.
   * Both need the network, and so does the address check in front of them, so
   * offline the buttons are disabled rather than left to fail.
   *
   * A contact that is not saved yet is excluded too: the form fills `mail` as
   * the user types, which used to be enough to enable the buttons for something
   * the other apps have no record of.
   */
  const canReachOtherApps = computed(
    () =>
      connectivityStatus.value === 'online' &&
      !!contact.value?.mail &&
      !isUserAddress.value &&
      !isContactNew.value,
  );

  /**
   * Keys are looked up for an existing correspondent, so there is nothing to
   * show for a contact that has not been saved. Unlike the two above this needs
   * no network: what is displayed comes from the keyring.
   */
  const canShowContactKeys = computed(() => !isUserAddress.value && !isContactNew.value);

  const canShowQr = computed(() => !isContactNew.value);
  /**
   * Why an action that needs a real correspondent is disabled. Both reasons
   * look the same to the eye - a greyed out button - so the tooltip has to say
   * which one it is; saying "available when online" to someone who simply has
   * not saved the contact yet sends them looking for a network problem.
   */
  const disabledActionReason = computed(() =>
    isContactNew.value ? t('reachability.contact-not-saved') : t('reachability.offline'),
  );
  const contactDisplayName = computed(() =>
    isUserAddress.value ? t('contact.myself.name') : contact.value?.name || contact.value?.mail || ' ',
  );
  const contactLetters = computed(() =>
    contactDisplayName.value.length > 1
      ? `${contactDisplayName.value[0].toLocaleUpperCase()}${contactDisplayName.value[1].toLocaleLowerCase()}`
      : contactDisplayName.value[0].toLocaleUpperCase(),
  );

  const contactAvatarStyle = computed<Record<string, string>>(() => ({
    ...(contact.value?.avatarId &&
      contact.value?.avatarImage && {
        backgroundImage: `url(${contact.value!.avatarImage})`,
      }),
    ...((!contact.value?.avatarId || !contact.value.avatarImage) && {
      backgroundColor: generateColor(contactLetters.value),
    }),
  }));

  const whetherContactChanged = computed(() => {
    if (!contact.value || !initialContact.value) {
      return false;
    }

    return Object.keys(pick(contact.value, ['mail', 'name', 'avatarId', 'phone', 'notice'])).some(field => {
      const oldFieldValue = initialContact.value![field as keyof Omit<Person, 'timestamp'>];
      const fieldValue = contact.value![field as keyof Omit<Person, 'timestamp'>];
      return fieldValue !== oldFieldValue;
    });
  });

  const rules = {
    mail: makeMailRules({
      t,
      isMailAddressInUse,
      ignoredAddresses: () => (initialContact.value?.mail ? [initialContact.value.mail] : []),
    }),
  };

  async function getContactData(): Promise<void> {
    if (!contactIdFromURL.value) {
      return;
    }

    if (contactIdFromURL.value === NEW_EMPTY_CONTACT_ID) {
      contact.value = cloneDeep(EMPTY_CONTACT);
      initialContact.value = cloneDeep(EMPTY_CONTACT);
      return;
    } else if (contactIdFromURL.value === NEW_POPULATED_CONTACT_ID) {
      contact.value = cloneDeep(contactDataFromCmd.value);
      contactDataFromCmd.value = cloneDeep(EMPTY_CONTACT);
      initialContact.value = cloneDeep(EMPTY_CONTACT);
      return;
    }

    try {
      isLoading.value = true;

      const data = await getContact(contactIdFromURL.value);
      if (data) {
        contact.value = {
          ...cloneDeep(EMPTY_CONTACT),
          ...data,
        };
        if (isUserAddress.value) {
          contact.value.name = t('contact.myself.name');
        }

        if (contact.value.avatarId) {
          appContactsSrvProxy.getImage(contact.value.avatarId).then(image => {
            contact.value!.avatarImage = image;
            initialContact.value!.avatarImage = image;
          });
        }

        initialContact.value = cloneDeep(contact.value);
      }
    } finally {
      isLoading.value = false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  async function delContact(doAfterDelete?: Function) {
    const res = await dialog.$openDialog(ConfirmationDialog, {
      dialogText: t('confirmation.delete.one', { name: `<b>${contactDisplayName.value}</b>` }),
      dialogProps: {
        title: t('contact.delete.title', 1),
        width: 300,
        confirmButtonText: t('contact.delete.confirmBtn'),
        cancelButtonText: t('contact.delete.cancelBtn'),
      },
    });

    const { event } = res;
    if (event === 'confirm') {
      try {
        isLoading.value = true;
        await deleteContact(contact.value!.id);
        notification.$createNotice({
          type: 'success',
          content: t('contact.delete.success', 1),
        });
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (err) {
        notification.$createNotice({
          type: 'error',
          content: t('contact.delete.error', 1),
        });
      } finally {
        isLoading.value = false;
        doAfterDelete && typeof doAfterDelete === 'function' && doAfterDelete();
        await cancel();
      }
    }
  }

  async function saveContact({
    excludeAvatarImageField,
    doAfterSave,
  }: {
    excludeAvatarImageField?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    doAfterSave?: Function;
  }): Promise<void> {
    if (!contact.value || !contactValid.value) {
      return;
    }

    const savingData = omit(contact.value, ['timestamp']);
    if (excludeAvatarImageField) {
      savingData.avatarImage = '';
    }

    try {
      isLoading.value = true;

      const res = await upsertContact(savingData);

      if ('errorType' in res) {
        notification.$createNotice({
          type: 'error',
          content: res.errorMessage,
          duration: 5000,
        });

        return;
      }

      notification.$createNotice({
        type: 'success',
        content: t('contact.upsert.success'),
      });

      if (isContactNew.value) {
        contact.value.id = res.id;
      }

      initialContact.value = cloneDeep(contact.value);
      doAfterSave && typeof doAfterSave === 'function' && doAfterSave();
      // isContactNew && await cancel();
      await cancel();
    } catch (e) {
      w3n.log('error', `[saveContact] A saving error. `, e);

      notification.$createNotice({
        type: 'error',
        content: t('contact.upsert.error'),
      });
    } finally {
      isLoading.value = false;
    }
  }

  async function cancel() {
    if (
      (!contact.value?.avatarId && !initialContact.value?.avatarId) ||
      contact.value?.avatarId === initialContact.value?.avatarId
    ) {
      await router.push({ name: 'contacts' });
    } else {
      appContactsSrvProxy.removeUnnecessaryImageFiles();
    }
  }

  async function blockContact(id: string) {
    try {
      isLoading.value = true;
      await changeContactBlockingSettings(id, true);
      updateContactField(id, ['settings', 'blockUser'], true);
      if (contact.value && contact.value.id === id) {
        contact.value.settings = {
          ...(contact.value.settings || {}),
          blockUser: true,
        };
      }
      if (initialContact.value && initialContact.value.id === id) {
        initialContact.value.settings = {
          ...(initialContact.value.settings || {}),
          blockUser: true,
        };
      }
    } catch (e) {
      w3n.log('error', `[blockContact] Error while blocking the contact with ID "${id}". `, e);

      notification.$createNotice({
        type: 'error',
        content: t('contact.block.error', { id }),
      });
    } finally {
      isLoading.value = false;
    }
  }

  async function unblockContact(id: string) {
    try {
      isLoading.value = true;
      await changeContactBlockingSettings(id, false);
      updateContactField(id, ['settings', 'blockUser'], false);
      if (contact.value && contact.value.id === id) {
        contact.value.settings = {
          ...(contact.value.settings || {}),
          blockUser: false,
        };
      }
      if (initialContact.value && initialContact.value.id === id) {
        initialContact.value.settings = {
          ...(initialContact.value.settings || {}),
          blockUser: false,
        };
      }
    } catch (e) {
      w3n.log('error', `[unblockContact] Error while unblocking the contact with ID "${id}". `, e);

      notification.$createNotice({
        type: 'error',
        content: t('contact.unblock.error', { id }),
      });
    } finally {
      isLoading.value = false;
    }
  }

  async function setUpContactBlocking({
    id,
    contactName,
    value,
  }: {
    id: string;
    contactName: string;
    value: boolean;
  }) {
    const res = await dialog.$openDialog<boolean>(ConfirmationDialog, {
      dialogText: value
        ? t('contact.block.dialogText', { contact: `<b>${contactName}</b>` })
        : t('contact.unblock.dialogText', { contact: `<b>${contactName}</b>` }),
      dialogProps: {
        icon: { icon: 'round-warning', color: 'var(--color-icon-control-warning-default)' },
        title: t('app.warning.label'),
        width: 300,
        confirmButtonText: value ? t('contact.block.confirmBtn') : t('contact.unblock.confirmBtn'),
        cancelButtonText: t('app.btn.cancel'),
      },
    });

    const { event } = res;
    if (event !== 'confirm') {
      return;
    }

    if (value) {
      await blockContact(id);
    } else {
      await unblockContact(id);
    }
  }

  /**
   * Asks ASMail whether the address can receive before handing the contact to
   * another app, and reports what came back.
   *
   * The check runs in the deno component, because only it is granted
   * `mail: { preflightsTo }`. It is a hint, not a gate on our own ability to
   * check: when the answer cannot be obtained, the handover proceeds.
   */
  async function withReachabilityCheck(handOver: () => Promise<void>): Promise<void> {
    const result = await appContactsSrvProxy.checkAddressReachability(contact.value!.mail);
    const { proceed, noticeKey, noticeType } = verdictForAddressCheck(result);

    if (noticeKey) {
      notification.$createNotice({
        type: noticeType ?? 'warning',
        content: t(noticeKey, { mail: contact.value!.mail }),
        duration: 5000,
      });
    }
    if (proceed) {
      await handOver();
    }
  }

  async function openChat() {
    await withReachabilityCheck(() =>
      w3n.shell!.startAppWithParams!(chatApp.domain, chatApp.openCmd, {
        peerAddress: contact.value!.mail,
      } as OpenChatCmdArg),
    );
  }

  async function openInbox() {
    await withReachabilityCheck(() =>
      w3n.shell!.startAppWithParams!(inboxApp.domain, inboxApp.openCmd, {
        peerAddress: contact.value!.mail,
      } as OpenInboxCmdArg),
    );
  }

  async function showOwnKeysInfo() {
    await dialog.$openDialog(OwnKeysInfoDialog, {
      dialogProps: {
        title: t('contact.dialog.title.own-keys'),
        confirmButton: false,
        cancelButton: false,
        closeOnClickOverlay: true,
      },
    });
  }

  async function showContactKeysInfo() {
    await dialog.$openDialog(ContactKeysInfoDialog, {
      contactAddr: contact.value!.mail,
      dialogProps: {
        title: t('contact.dialog.title.contact-keys', {
          contact: contact.value!.name ?? contact.value!.mail,
        }),
        confirmButton: false,
        cancelButton: false,
        closeOnClickOverlay: true,
      },
    });
  }

  async function showQRcode(id: string) {
    const contactData = await getContact(id);
    await dialog.$openDialog(ShareQrDialog, {
      contactData: contactData,
      dialogProps: {
        title: 'Sharing',
        confirmButton: false,
        cancelButton: false,
        closeOnClickOverlay: true,
        width: 350,
      },
    });
  }

  async function onFieldUpdate({ field, val }: { field: ContactTextField; val: string }) {
    contact.value![field] = val;
  }

  async function uploadImage() {
    const imagesExtensions = ['jpeg', 'jpg', 'png', 'gif'];

    // The dialog is served over RPC by the files app, so it can fail on its own
    // - seen as rpc/connectionClosed when that app was not reachable. It sits
    // ahead of the try below, whose finally only clears imageProcessing, so the
    // rejection used to surface as an unhandled one with a Vue warning on top.
    let files: web3n.files.ReadonlyFile[] | undefined;
    try {
      files = await w3n.shell!.fileDialogs!.openFileDialog!('Open', '', false, {
        filters: [
          {
            name: 'Images',
            extensions: imagesExtensions,
          },
        ],
      });
    } catch (err) {
      w3n.log('error', 'Could not open the dialog to pick an avatar file', err);
      return;
    }

    if (!files) {
      return;
    }

    const ext = getFileExtension(files[0].name);
    if (!imagesExtensions.includes(ext)) {
      return;
    }

    try {
      imageProcessing.value = true;
      const file = await transformWeb3nFileToFile(files[0]);
      await schedulerYield();
      const imageMain = await resizeImage(file!, 104);
      await schedulerYield();
      const imageMini = await resizeImage(file!, 40);
      await schedulerYield();
      const imageMainFileId = await appContactsSrvProxy.addImage({ base64: imageMain });
      await sleep(10);
      await appContactsSrvProxy.addImage({
        base64: imageMini,
        id: `${imageMainFileId}-mini`,
        withUploadParentFolder: true,
      });
      contact.value!.avatarImage = imageMini;
      contact.value!.avatarId = imageMainFileId;

      if (isContactNew.value) {
        await saveContact({ excludeAvatarImageField: true });
        upsertContactListItem(contact.value!.id, {
          avatarId: imageMainFileId,
          avatarImage: imageMini,
        });
      }
    } finally {
      imageProcessing.value = false;
    }
  }

  async function deleteImage() {
    const imageFileId = contact.value!.avatarId;
    contact.value!.avatarId = undefined;
    contact.value!.avatarImage = undefined;

    if (isContactNew.value) {
      await saveContact({});
    }

    await appContactsSrvProxy.deleteImage(imageFileId!);
  }

  return {
    route,
    router,
    notification,
    rules,
    user,
    contentEl,
    isLoading,
    contactIdFromURL,
    contact,
    initialContact,
    isContactNew,
    isUserAddress,
    canReachOtherApps,
    canShowContactKeys,
    canShowQr,
    disabledActionReason,
    whetherContactChanged,
    contactValid,
    contactDisplayName,
    contactLetters,
    contactAvatarStyle,
    imageProcessing,
    contactSettings,
    getContactData,
    fetchContacts,
    delContact,
    saveContact,
    cancel,
    upsertContact,
    upsertContactListItem,
    openChat,
    openInbox,
    showContactKeysInfo,
    showOwnKeysInfo,
    onFieldUpdate,
    uploadImage,
    deleteImage,
    showQRcode,
    setUpContactBlocking,
  };
}
