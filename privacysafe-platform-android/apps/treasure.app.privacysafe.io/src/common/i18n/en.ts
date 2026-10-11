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
    title: 'Treasure',
    menu: {
      makeBackup: 'Make Backup',
      uploadBackup: 'Upload Backup',
      exit: 'Exit',
    },
    status: {
      label: 'Status',
      online: 'Online',
      offline: 'Offline',
    },
    btn: {
      close: 'Close',
      cancel: 'Cancel',
      save: 'Save',
      apply_crop: 'Apply crop',
    },
  },
  list: {
    create: 'New Record',
    createGroup: 'New Group',
    editGroup: 'Edit Group',
    editRecord: 'Edit Record',
    addToFavorites: 'Add To Favorites',
    removeFromFavorites: 'Remove from Favorites',
    copyUsername: 'Copy Username',
    copyPassword: 'Copy Password',
    copyCardNumber: 'Copy Card Number',
    copyCardHolder: 'Copy Card Holder',
    copyCardExp: 'Copy Expire Date',
    copyCardCvv: 'Copy CVV',
    copyRecord: 'Copy Record',
    all: 'All Records',
    recent: 'Recent',
    bank_cards: 'Bank Cards',
    cards: 'Custom Cards',
    favorites: 'Favorites',
    search: 'Search records',
    noData: 'No records here',
    notifications: {
      success: {
        saving: 'The {entity} was saved successfully.',
        deleting: 'The {entity} was deleted successfully.',
      },
      error: {
        saving: `Oops. Error saving {entity} '{name}'. Try again later, please.`,
        deleting: `Oops. Error deleting {entity} '{name}. Try again later, please.'`,
      },
      warning: {
        delete: 'You cannot delete the group. There are records in this group.',
      },
    },
  },
  recordDialog: {
    title: {
      add: 'Add New Record',
      add_card: 'Add New Card',
      add_bank_card: 'Add New Bank Card',
      edit: 'The Record Details',
      edit_card: 'The Card Details',
      edit_bank_card: 'The Bank Card Details',
    },
    btn: {
      close: 'Close',
      create: 'Create',
      discard: 'Discard',
      save: 'Save Changes',
      delete: 'Delete The Record',
      switch_to: 'Switch to',
    },
    form: {
      fields: {
        name: {
          label: 'Service name',
          placeholder: 'Enter the current record name',
        },
        resource: {
          label: 'Resource',
          placeholder: 'Enter the current record resource name or domain',
          required: 'The resource field cannot be empty. ',
          unique: 'There is already a record with the same values in fields resource and username. ',
        },
        username: {
          label: 'Username',
          placeholder: 'Enter the user name for the selected resource',
          required: 'The username field cannot be empty. ',
          unique: 'There is already a record with the same values in fields username and resource. ',
        },
        password: {
          label: 'Password',
          placeholder: 'Enter the password',
          required: 'The password field cannot be empty. ',
        },
        group: {
          label: 'Group',
          placeholder: 'Select the group',
        },
        cardName: {
          label: 'Card name',
          placeholder: 'Enter the current card name',
          required: 'The card name field cannot be empty. ',
          unique: 'A card with the with the same name already exists. ',
        },
        bancCardName: {
          label: 'Bank card name',
          placeholder: 'Enter the current bank card name',
          required: 'The bank card name field cannot be empty. ',
        },
        cardNumber: {
          label: 'Card number',
          placeholder: 'XXXX XXXX XXXX XXXX',
          required: 'The card number field cannot be empty',
          length: 'The card number must consist of 16 digits ',
        },
        cardHolder: {
          label: 'Card holder',
          placeholder: 'FULL NAME',
          required: 'The card holder field cannot be empty ',
        },
        cardExp: {
          label: 'Expiry',
          placeholder: 'MM/YY',
          required: 'The expiry date field cannot be empty ',
          format: 'The value in the field does not match the format (MM/YY) ',
          month: 'The month value must be between 01 and 12 ',
        },
        cardCvv: {
          label: 'CVV',
          placeholder: '123',
          required: 'The CVV field cannot be empty ',
          length: 'The field value must contain 3 or 4 digits ',
        },
      },
      btns: {
        generate: 'Generate password',
      },
      image: {
        upload_btn: 'Upload images',
        upload_area: 'Click this area to upload images',
        info: 'No more than 10 image files of supported formats (png, jpeg, jpg)',
        uploading: 'Uploading',
        message: {
          unsupported: 'These are unsupported files: {list}',
          limit: 'The total number of images will exceed the allowed limit. Some new images will not be uploaded.',
        },
        upload_custom_card_images: 'Select Card Images',
        upload_images_btn: 'Upload',
      },
    },
    record_type: {
      password: 'Password Record',
      card: 'Custom Card',
      bank_card: 'Bank Card',
    },
    text: {
      or: 'or',
    },
  },
  groupDialog: {
    title: {
      add: 'Add New Group',
      edit: 'The Group Details',
    },
    btn: {
      close: 'Close',
      create: 'Create',
      save: 'Save Changes',
      delete: 'Delete The Group',
    },
    form: {
      fields: {
        name: {
          label: 'Group Name',
          placeholder: 'Enter the group name',
          required: 'The group name field cannot be empty. ',
          unique: 'There is already a group with the same name. ',
        },
        description: {
          label: 'Group Description',
          placeholder: 'Enter the group description',
        },
      },
    },
  },
  confirmationDeleteGroupDialog: {
    title: 'Delete Group',
    text: 'Are you sure you want to delete this group?',
    confirmButtonText: 'Delete',
    cancelButtonText: 'Cancel',
  },
  confirmationDeleteRecordDialog: {
    title: 'Delete Record',
    text: 'Are you sure you want to delete this record?',
    confirmButtonText: 'Delete',
    cancelButtonText: 'Cancel',
  },
  treasuresTable: {
    header: {
      name: 'Name',
      sync: 'Sync',
      username: 'Username / Holder name / Photo',
      holderName: 'Holder name',
      photo: 'Photo',
      password: 'Password / CVV',
      cvv: 'CVV',
    },
    nodata: 'No records in current group.',
    row: {
      copiedBtn: 'Copied',
      duplicateTooltip: 'There is another record with the same `resource` and `username` values',
    },
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
      dialogTitle: 'Backup Creating',
      fileDialogTitle: 'Save Backup',
      fileDialogBtn: 'Save',
      text: {
        scanning: 'Scanning the file system',
        compressing: 'Compress {number} file out of {total}',
        encrypting: 'Encrypting the archive',
        saving: 'Saving the backup file',
      },
      success: 'The backup {filename} was created and saved',
      warning: 'No data for backup.',
      cancel: 'The backup process was interrupted by the user.',
      error: 'An error occurred while creating the backup file.',
    },
    restore: {
      dialogTitle: 'Restore Backup',
      fileDialogTitle: 'Select Backup File',
      fileDialogBtn: 'Open',
      confirmTitle: 'Confirm Data Restoration',
      confirmText:
        'Restoring from backup (version {version}) will replace all current passwords, cards, and groups. This action cannot be undone. Do you want to proceed?',
      confirmBtn: 'Restore',
      confirmWarningTitle: 'Compatibility Warning',
      confirmWarningText:
        'The backup archive version ({archiveVersion}) is not fully compatible with the application version ({appVersion}), or metadata is missing. Restoring this archive may damage application data or cause errors. Do you want to proceed at your own risk?',
      confirmAtOwnRiskBtn: 'Restore at own risk',
      text: {
        unpacking: 'Unpacking and reading archive',
        decrypting: 'Decrypting the archive',
        restoring: 'Restoring {number} file out of {total}',
        syncing: 'Synchronizing restored data',
        syncingWithCount: 'Synchronizing {number} file out of {total}',
        completed: 'Restoration completed',
      },
      success: 'Backup was successfully restored.',
      error: 'An error occurred while restoring the backup.',
      errorCorruptedArchive: 'Failed to read the backup archive: file is corrupted or not a valid ZIP.',
      errorForeignArchive: 'This archive holds no Treasure data. It may be a backup of another app.',
      errorPassphraseRequired: 'This archive is encrypted and needs its passphrase.',
      errorEncryptionUnsupported: 'This archive is encrypted, and this app cannot decrypt it here.',
    },
  },
};
