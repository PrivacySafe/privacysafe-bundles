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
export const en = {
  app: {
    title: 'Contacts',
    sync: {
      status: 'Sync Status',
    },
    status: {
      label: 'Status',
      connected: {
        online: 'online',
        offline: 'offline',
      },
      synced: 'synced',
      unsynced: 'unsynced',
    },
    exit: 'Close',
    menu: {
      tutorial: 'Repeat Tutorial',
      makeBackup: 'Create backup',
      uploadBackup: 'Restore from backup',
      exit: 'Close',
    },
    btn: {
      cancel: 'Cancel',
      save: 'Save',
      add: 'Add New',
    },
    info: {
      status: {
        online: 'You are currently online. All previously made changes will be synchronized.',
        offline: 'You are currently offline. All changes will stay on this device till it gets connected.',
      },
    },
    warning: {
      label: 'Warning',
      'sync-stuck':
        'Synchronization has not resumed, although this device is online. Changes are being kept on this device. Restart the app to sync them.',
      'changes-not-published':
        'Changes made on this device are saved here, but the server keeps refusing them. They are not lost, and will be published as soon as it accepts them again. Restarting the app sometimes helps.',
      'first-run-needs-network':
        'This app has to be started once while online: its storage cannot be created on this device without the server. Connect and start the app again.',
      'service-unavailable': 'The contacts service did not start. Restart the app.',
    },
  },
  action: {
    select: {
      all: 'Select all',
    },
    deselect: {
      all: 'Deselect all',
    },
    open: {
      chat: {
        tooltip: 'Open a chat with the contact',
      },
      mail: {
        tooltip: 'Create a message to the contact',
      },
    },
    show: {
      keys: {
        own: 'Show own keys info',
        contact: 'Show the contact keys info',
      },
    },
  },
  confirmation: {
    warning: 'Warning',
    delete: {
      one: 'You try to Delete {name} Contact. This operation will remove all Activities from the User.',
      multiple: 'You try to Delete {count} Contacts. This operation will remove all Activities from the User.',
    },
  },
  contacts: {
    search: {
      placeholder: 'Search in contact names and mail',
    },
  },
  contact: {
    action: {
      delete: 'Delete the contact',
      block: 'Add to the block list',
      unblock: 'Remove from the block list',
    },
    block: {
      dialogText: 'You try to Move {contact} to the block list',
      error: 'Error while blocking the contact with ID "{id}"',
      confirmBtn: 'Block',
      mark: 'Blocked',
    },
    unblock: {
      dialogText: 'You try to Remove {contact} from the block list',
      error: 'Error while unblocking the contact with ID "{id}"',
      confirmBtn: 'Unblock',
    },
    delete: {
      title: 'Delete Contact | Delete Contacts',
      confirmBtn: 'Delete',
      cancelBtn: 'Cancel',
      success: 'The Contact was deleted. | The Contacts was deleted.',
      error: 'Delete contact error. Contact Support. | Delete contacts error. Contact Support.',
    },
    upsert: {
      success: 'The contact was saved.',
      error: 'Save contact error. Contact Support.',
    },
    placeholder: 'Select User to see Details',
    avatar: {
      upload: 'Upload image',
      delete: 'Delete image',
    },
    content: {
      identity: 'Identity',
      name: 'Name',
      phone: 'Phone',
      note: 'Note',
    },
    myself: {
      name: 'Me',
    },
    dialog: {
      title: {
        'own-keys': 'Own Keys',
        'contact-keys': '{contact} Keys',
      },
    },
  },
  validation: {
    text: {
      required: 'This field is required.',
      mail: 'Not valid address.',
      usage: 'This mail is already in use.',
    },
  },
  'keys-info': {
    'key-on-server': {
      'no-key':
        "No introductory public key is present on the server. Without such key new people can't send you messages, while existing contacts with established communication key chains can continue sending you messages.",
      section: 'Introductory Public Key on ASMail Server',
      btn: {
        'make-new': 'Create New Key',
        update: 'Update Key',
        remove: 'Remove Key',
      },
    },
    'sending-key-pair': 'Key Pair for Sending',
    'receiving-key-pair-in-use': 'Key Pair in use for Receiving',
    'receiving-key-pair-suggested': 'Key Pair suggested next for Receiving',
    'receiving-key-pair-old': 'Previous Key Pair for Receiving',
    'no-contact-keys': 'No keys present for this contact.',
    'key-id': 'Key Id',
    'your-key-id': 'Your Key Id',
    'contact-key-id': `Contact's Key Id`,
    'contact-intro-key-id': `Contact's Introductory Key Id`,
    expiry: 'Expiry',
    alg: 'Algorithm',
    'mid-certifier': 'MailerId certifier',
    timestamp: 'Timestamp',
    'last-msg-ts': 'Last used at',
    'num-of-sent-msgs': 'Number of sent messages',
    'received-msgs': 'Received messages',
    'random-pids': 'Randomized Pair Ids',
  },
  reachability: {
    'not-present-at-domain':
      'There is no such account at that domain, so {mail} cannot receive messages. Check the address.',
    'no-service-for-domain': 'That domain runs no 3NWeb messaging service, so {mail} cannot receive messages.',
    'access-restricted': '{mail} exists but restricts who may write to it, so your message may not be accepted.',
    offline: 'Available when online.',
    'contact-not-saved': 'Available after the contact is saved.',
  },
  backup: {
    passphrase: {
      createTitle: 'Protect the backup',
      openTitle: 'Passphrase required',
      createHint: 'A passphrase encrypts the archive. Leave both fields empty to save it unencrypted.',
      openHint: 'This backup archive is encrypted. Enter the passphrase it was created with.',
      label: 'Passphrase',
      repeatLabel: 'Repeat passphrase',
      placeholder: 'Leave empty for no encryption',
      openBtn: 'Open',
      show: 'Show passphrase',
      hide: 'Hide passphrase',
      wrong: 'That passphrase does not open this archive.',
      mismatch: 'The two passphrases do not match.',
      tooShort: 'A passphrase has to be at least {count} characters long.',
      noRecovery: 'A forgotten passphrase cannot be recovered: the archive stays unreadable.',
      optional: 'Without a passphrase the archive is only as private as the place you keep it in.',
    },
    create: {
      dialogTitle: 'Creating backup',
      fileDialogTitle: 'Save backup',
      fileDialogBtn: 'Save',
      text: {
        scanning: 'Reading the address book',
        compressing: 'Packing {number} of {total}',
        encrypting: 'Encrypting the archive',
        saving: 'Saving the backup file',
      },
      success: 'The backup {filename} was saved.',
      empty: 'There is nothing to back up.',
      cancel: 'Creating the backup was stopped.',
      error: 'The backup could not be created.',
    },
    restore: {
      dialogTitle: 'Restoring backup',
      fileDialogTitle: 'Select backup file',
      fileDialogBtn: 'Open',
      confirmTitle: 'Confirm restoration',
      confirmText:
        'Restoring will replace your {current} contacts with the {archived} contacts in this backup. Contacts that are not in the backup will be deleted. This cannot be undone.',
      confirmBtn: 'Restore',
      confirmWarningTitle: 'Compatibility warning',
      confirmWarningText:
        'This archive was written by version {archiveVersion}, and this app is version {appVersion}, or the archive carries no version at all. Restoring it may damage the address book. Proceed at your own risk?',
      confirmAtOwnRiskBtn: 'Restore anyway',
      unknownVersion: 'unknown',
      text: {
        unpacking: 'Reading the archive',
        decrypting: 'Decrypting the archive',
        restoringImages: 'Restoring image {number} of {total}',
        restoringContacts: 'Restoring {total} contacts',
        syncing: 'Synchronizing restored data',
        syncDeferred: 'Restored on this device; it will be synchronized later',
        completed: 'Restoration completed',
      },
      success: 'The backup was restored.',
      error: 'The backup could not be restored.',
      errorCorruptedArchive: 'This file is damaged or is not a ZIP archive.',
      errorForeignArchive: 'This archive is a backup of another app, not of contacts.',
      errorNoContacts: 'This archive holds no contacts. It may be a backup of another app.',
      errorUnreadableDb: 'The contacts in this archive cannot be read.',
      errorPassphraseRequired: 'This archive is encrypted and needs its passphrase.',
      errorEncryptionUnsupported: 'This archive is encrypted, and this app cannot decrypt it here.',
    },
  },
  qrcode: {
    'save-dialog-title': 'Save QR Code',
    'save-dialog-button': 'Save ME',
    'save-qr-tooltip': 'Save / Download QR Code',
    'copy-link-tooltip': 'Copy Link',
    'copy-link-text': 'Link Copied',
    'save-success': 'QR Code save successfully',
    'save-invalid': 'Invalid image format',
    'color-qr-tooltip': 'Change Color',
    'color-close-panel': 'Close',
    'copy-link-error': 'Error copying link',
    'download-qr-error': 'Error saving QR Code image',
  },

  tutorial: {
    create: 'Tap to start creating a new contact.',
    mobileMenuBtn: 'Tap to open the app menu.',
    meListItem:
      'This is how a contact list item is displayed. Tapping it allows you to open the contact editing form.',
    'make-backup': 'By tapping you will start the process of creating a file for backup.',
    'upload-backup':
      'Tapping this will start the process of restoring application data from the backup file you selected.',
    'repeat-tutorial': 'Tapping this restarts the tutorial.',
  },
};
