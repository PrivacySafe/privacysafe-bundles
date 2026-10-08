export const en = {
  app: {
    title: 'Inbox',
    status: {
      label: 'Status',
      connected: {
        online: 'online',
        offline: 'offline',
      },
    },
    startup: {
      starting: 'Starting ...',
      'migrating-db': 'Moving the mailbox to this device ...',
      'migrating-files': 'Moving attachments to this device: {done} of {total}',
      loading: 'Loading messages ...',
    },
    sync: {
      syncing: 'Synchronizing with your other devices…',
      syncing_count: 'Synchronizing with your other devices… ({count} left)',
      // Said only when a pass has actually failed: this is the one state the
      // user can do something about, so it is worded as waiting rather than as
      // breakage.
      stalled: 'Changes are waiting to be sent',
    },
    select: 'Select',
    ok: 'Ok',
    new: {
      mail: 'New Mail',
    },
    menu: {
      refresh: 'Force-refresh data',
      manageBlocks: 'Manage blocks',
      makeBackup: 'Create a backup',
      restoreBackup: 'Restore from a backup',
      exit: 'Exit',
    },
    notification: {
      noNewMessages: 'No new messages',
    },
    btn: {
      cancel: 'Cancel',
      save: 'Save',
      back: 'Back',
      continue: 'Continue',
      send: 'Send',
    },
  },

  backup: {
    // One set of lines for both places the same fact is told: after a backup,
    // and before a restore of one.
    skipped: {
      onAnotherDevice:
        '{count} file(s) were attached on another of your devices, and file bytes never travel ' +
        'between devices.',
      notRequested: '{count} file(s) were left out because you asked for an archive without them.',
      external:
        '{count} file(s) are too big to be copied and were attached by reference, so the ' +
        'archive points at them rather than holding them.',
      origin: '{count} file(s) belong to received messages and stay on the server.',
      unreadable: '{count} file(s) could not be read.',
      noLocalSource: '{count} file(s) have no readable file on this device.',
    },
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
        scanning: 'Reading the mailbox',
        compressing: 'Packing {number} of {total}',
        encrypting: 'Encrypting the archive',
        saving: 'Saving the backup file',
      },
      // A permanent explanation rather than a warning to confirm: it is not
      // about the risk of this action but about the boundary of what an archive
      // can ever bring back.
      attachmentsNotice:
        'Attachments of received messages are kept on the server and do not go into the ' +
        'archive. Delete such a message from the server and its attachments are lost — the ' +
        'messages themselves will still be restored.',
      // The line a live run went without: an archive came out with no
      // attachments at all, because the files had been attached on another
      // device and file bytes never travel between devices.
      thisDeviceNotice:
        'Only files that are on this device go into the archive. A message whose file was ' +
        'attached on another of your devices is backed up without it, so take the backup ' +
        'where the files are.',
      success: 'The backup {filename} was saved.',
      skippedTitle: 'Some files did not go into the archive.',
      empty: 'There is nothing to back up.',
      cancel: 'Creating the backup was stopped.',
      error: 'The backup could not be created.',
      errorTooLarge:
        'This mailbox is too big to be carried into an archive whole. Take a backup without ' +
        'attachments instead.',
    },
    restore: {
      dialogTitle: 'Restoring backup',
      fileDialogTitle: 'Select backup file',
      fileDialogBtn: 'Open',
      confirmTitle: 'Restore from a backup',
      confirmBtn: 'Restore',
      confirmWarningText:
        'This archive was written by version {archiveVersion}, and this app is version ' +
        '{appVersion}, or the archive carries no version at all. Restoring it may damage the ' +
        'mailbox. Proceed at your own risk.',
      unknownVersion: 'unknown',
      unknownDate: 'unknown',
      skippedTitle: 'This archive does not hold every file:',
      summary: {
        createdAt: 'Backup taken',
        messages: 'Messages in the archive',
        attachments: 'Attachments in the archive',
        current: 'Messages here now',
      },
      mode: {
        mergeTitle: 'Add what is missing',
        mergeHint:
          'Messages and folders that are not here are put back. Nothing that is here is ' +
          'changed, and nothing is deleted. A message deleted after the backup stays deleted.',
        replaceTitle: 'Make the mailbox match the archive',
        replaceHint:
          'The archive states what the mailbox is. Anything you changed after the backup was ' +
          'taken still wins over it.',
        replaceWarning:
          'Messages and folders that are not in the archive, and that are older than it, will ' +
          'be deleted — on this device and on your other ones.',
      },
      devicesNotice:
        'Whatever you choose here is what every device of yours will do: the restore is sent ' +
        'to them and applied by the same rule.',
      text: {
        unpacking: 'Reading the archive',
        decrypting: 'Decrypting the archive',
        listingInbox: 'Checking which messages are still on the server',
        restoringAttachments: 'Restoring attachment {number} of {total}',
        restoringMessages: 'Restoring {number} of {total}',
        announcing: 'Telling your other devices',
        completed: 'Restoration completed',
      },
      success: 'The backup was restored: {created} added, {updated} updated, {deleted} deleted.',
      offlineNotice:
        'The server could not be reached, so it is not known which received messages are still ' +
        'there. Some attachments may turn out to be unavailable.',
      error: 'The backup could not be restored.',
      errorCorruptedArchive: 'This file is damaged or is not a ZIP archive.',
      errorForeignArchive: 'This archive is a backup of another app, not of the mailbox.',
      errorNoMessages: 'This archive holds no messages. It may be a backup of another app.',
      errorUnreadableRecords: 'The messages in this archive cannot be read.',
      errorPassphraseRequired: 'This archive is encrypted and needs its passphrase.',
      errorEncryptionUnsupported: 'This archive is encrypted, and this app cannot decrypt it here.',
    },
  },

  msg: {
    create: {
      dialog: {
        title: 'New Mail',
      },
      label: {
        from: 'From',
        to: 'To',
        subject: 'Subject',
      },
      placeholder: {
        contacts: 'Enter 3NWeb or standard email',
        editor: 'Enter the message text ...',
      },
      recipient: {
        blocked: '{mail} is blocked, and was removed from the recipients.',
      },
      btn: {
        attach: 'Attach Files',
        editor_formating: 'Formating',
        discard: 'Discard',
        send: 'Send',
      },
      report: {
        subject: 'PrivacySafe Inbox report',
      },
    },
    text: {
      no_selected: {
        part1: 'No email selected.',
        part2: 'Select a message to view its contents.',
      },
    },
    sending: {
      label: {
        canceled: 'Sending canceled',
        error: 'Sending error',
        progress: 'Sending in Progress...',
      },
      error: {
        unknownRecipient: 'unknown recipient',
        msgTooBig: 'this message is bigger than allowed',
        inboxIsFull: 'mailbox of this recipient is full',
        domainNotFound: 'this domain is not found',
        noServiceRecord: 'this domain does not support 3N',
        recipientPubKeyFailsValidation: 'the public key is not valid',
        blocked: 'you have blocked this address',
        noDescription: 'No description',
      },
      progress: 'Complete {percent} ({currentValue} of {totalValue})',
    },
    content: {
      preflight_error: 'The message could not be sent to the specified recipients.',
      sending_on_another_device: 'This message is being sent from another of your devices.',
      add_address: 'Add address to the Contacts',
      blocked_sender: 'You have blocked this address',
      blocked_reply: 'You cannot reply to a blocked address. Unblock it first.',
      btn: {
        moveToTrash: 'Move to Trash',
        deleteForever: 'Delete Forever',
        attachments_collapse: 'Collapse',
      },
      tooltip: {
        delete: 'Delete message',
        resend: 'Resend',
        cancel_sending: 'Cancel sending',
        edit: 'Edit',
        send: 'Send',
        download: 'Download the file',
        download_all: 'Download all files',
        view: 'View the file',
        make_preview: 'Show a preview (reads the whole file)',
        reply: 'Reply',
        replyAll: 'Reply All',
        forward: 'Forward',
        restore: 'Restore',
        // Worded as in chat.app, for the reason given over `dialog.label`.
        block: 'Block User',
        unblock: 'Unblock User',
        report: 'Report',
      },
      editor: {
        fontSize: 'Font size',
        fontSize_header: 'Header',
        fontSize_normal: 'Normal',
        bold: 'Bold',
        unbold: 'Unbold',
        italic: 'Italic',
        noItalic: 'Remove italic',
        underline: 'Underline',
        noUnderline: 'Remove underline',
        strikethrough: 'Strikethrough',
        noStrikethrough: 'Remove strikethrough',
        ordered: 'Ordered list',
        unordered: 'Unordered list',
        noList: 'Remove list',
        decreaseListLevel: 'Decrease list level',
        increaseListLevel: 'Increase list level',
        align_left: 'Align left',
        align_right: 'Align right',
        align_center: 'Align center',
        align_justify: 'Align justify',
        quote: 'Blockquote',
        code: 'Code',
        noCode: 'Remove code',
      },
    },
    actions: {
      select_all: 'Select all',
      deselect_all: 'Deselect all',
      selected: 'Selected',
      cancel: 'Cancel',
      cancel_tooltip: 'Reset marked messages',
    },
    permanent_delete: {
      title: 'Confirm Permanent Deletion',
      string1: 'Are you sure you want to permanently delete selected message(s)?',
      string2: 'This action cannot be undone.',
      confirm_button: 'Delete Completely',
    },
    download: {
      title: 'Select a folder for downloading',
      file_title: 'Save file',
    },
    preflight_dialog: {
      title: 'Preflight processing',
      processing_text: 'Preparing to send... Checking recipient availability. Please wait.',
      subtitle: 'The following address is currently unavailable, and messages cannot be delivered to it:',
      question: 'Would you like to send the message anyway?',
      confirm_button: 'Send Anyway',
    },
    reply_title: 'Original message',
    forward_title: 'Forwarded message',
    attachments: {
      writing: {
        success: 'Attachments have saved',
        error: 'Error writing attachments',
      },
      removing: {
        error: 'Error removing attachments',
      },
      linking: {
        error: 'Error opening attachments of this draft',
      },
      on_another_device: 'These files were attached on another of your devices and are not available here.',
      partially_downloaded: '{done} of {total} files saved; the rest are on another of your devices.',
    },
    attachment: {
      writing: {
        success: 'The file {fileName} has saved',
        error: 'Error writing the file {fileName}',
      },
      attaching: {
        error: 'Error attaching the file {fileName}',
      },
      too_big: {
        error: 'The file {fileName} is bigger than the {limit} limit and cannot be attached',
      },
      unavailable:
        'The file {fileName} cannot be read — it looks like it was deleted, moved or renamed. Attach it again to send this message.',
      link_broken: 'The file {fileName} cannot be shown — it looks like it was deleted, moved or renamed.',
      on_another_device: 'The file {fileName} was attached on another of your devices and is not available here.',
      on_another_device_short: 'On another device',
      loading: '{done} of {total}',
      loading_cancel: 'Cancel',
      removing: {
        error: 'Error removing the file {fileName}',
      },
      view_exit: 'Exit viewing',
    },
  },

  folder: {
    empty: {
      title: 'Folder is empty',
      text: {
        inbox:
          'The Inbox folder stores all incoming emails that you have received from 3NWeb services and classic mail services.',
        outbox:
          'The Outbox folder temporarily holds emails that have been sent but are still in the process of being delivered.',
        draft:
          'The Draft folder holds emails you started writing but haven’t sent yet — they’re saved for you to finish and send later.',
        sent: 'The Sent folder contains copies of emails that you have successfully sent to others.',
        trash:
          'The Trash folder temporarily holds deleted emails. Messages stay here until they are permanently removed either manually or after a set period.',
      },
    },
  },

  confirmation: {
    dialog: {
      text: 'Are you sure?',
    },
  },

  dialog: {
    'open-file': {
      'image-type': 'Images',
    },
    // Worded as in chat.app: one blacklist, told about in one voice, whichever
    // app the user happens to be blocking from.
    label: {
      warning: 'Warning',
    },
    button: {
      block: 'Block',
      unblock: 'Unblock',
      cancel: 'Cancel',
      close: 'Close',
    },
    text: {
      block: 'Block the user {mail}?',
      unblock: 'Unblock the user {mail}?',
    },
    additionalText: {
      block:
        'They will no longer be able to send you messages or call you through PrivacySafe.' +
        '<br>Existing messages will remain in your mailbox.',
      unblock: 'They will be able to send you messages and call you through PrivacySafe again.',
    },

    'report-dialog': {
      title: 'Report a message or a sender',
      // On the phone the form is a page, and the line above does not fit
      // between the arrow back and the button that sends.
      pageTitle: 'Report',
      content: {
        'reasons-label': 'Tell us why you are reporting it.',
        reason: {
          label: 'Reason',
          spam: 'Spam',
          harassment: 'Harassment or threats',
          fraud: 'Impersonation or fraud',
          activity: 'Harmful or illegal activity',
          other: 'Other',
        },
        fieldsetLabel: 'This will disclose the contents of the reported message to the PrivacySafe abuse team.',
        reportedMessage: 'Include the reported message?',
        reportedAttachments: 'Include the reported message attachments?',
        step2SubTitle: 'Your report message',
        step2Preamble: 'I would like to report a PrivacySafe Inbox message or sender.',
        step2Additional: 'Additional details',
        step2Block: 'Would you also like to block this sender?',
        // Who is being reported, and when their message came, are in every
        // report: the toggle above discloses the contents of the message, and a
        // complaint about nobody is one the abuse team can do nothing with.
        reportedSender: 'Reported sender',
        reportedReceivedAt: 'Received',
        reportedMsgId: 'Message id',
        reportedMessageTitle: 'Reported message',
        attachmentsNote: 'The attachments of the reported message are attached to this report.',
        attachmentsFailed: 'These attachments of the reported message could not be attached: {files}',
      },
      notif: {
        noReportAddress: 'Error retrieving the address for sending the report',
        reportAddressBlocked:
          'You have blocked {mail}, the address reports of this domain go to. Unblock it to report.',
        blocked: '{mail} has been blocked',
        attachmentsError: 'Some attachments of the reported message could not be attached to the report',
        sending: 'The report is being sent. Its progress is in the Outbox.',
        sent: 'The report has been sent',
        sendError: 'The report could not be sent',
      },
    },
  },

  manageBlocks: {
    dialog: {
      title: 'Manage blocks',
      search_placeholder: 'Search by name or address',
      section: {
        contacts: 'Contacts',
        used: 'Not in contacts',
      },
      nobody: 'Nothing matches the search',
    },
  },

  contact: {
    // Said on a row the recipient list shows but refuses to pick, as chat.app
    // says it on a contact it will not start a chat with.
    blocked: {
      mark: 'Blocked',
    },
    error: {
      block: 'Failed to block the contact',
      unblock: 'Failed to unblock the contact',
    },
  },

  chat: {
    pdf: {
      view: {
        btn: {
          prev: 'Previous page',
          next: 'Next page',
        },
        page: 'Page',
      },
    },
    player: {
      play: 'Play',
      pause: 'Pause',
    },
    audio: {
      player: {
        visual: {
          setting: 'Visualization setting',
          mode1: 'Mode 1',
          mode2: 'Mode 2',
        },
      },
    },
    view: {
      load: {
        file: {
          error: 'Error loading the file',
        },
      },
    },
  },
};
