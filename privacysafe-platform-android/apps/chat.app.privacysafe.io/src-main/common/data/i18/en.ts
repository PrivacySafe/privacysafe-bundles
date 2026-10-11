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
    title: 'Chat',
    status: {
      label: 'Status',
      connected: {
        online: 'online',
        offline: 'offline',
      },
    },
    sync: {
      label: 'Synchronizing…',
      labelWithCount: 'Synchronizing… ({count})',
      catchUp: 'Catching up on messages…',
      stalled: 'Changes are waiting to be sent',
      stalledTooltip:
        'Changes made here have not reached your other devices yet; ' + 'they are kept and will be sent again',
      tooltip: {
        idle: '',
        'catch-up': 'Catching up on messages received while the app was closed',
        incoming: 'Applying changes made on your other devices',
        outgoing: 'Sending changes to your other devices',
      },
      duplicateInstance:
        'Another copy of the app uses the same data folder, ' +
        'so both act as the same device and cannot synchronize with each other. ' +
        'Start the second copy with its own data folder.',
    },
    orientation: {
      rotateBack: 'Please rotate your phone back to portrait orientation',
    },
    startup: {
      starting: 'Starting…',
      stillStarting: 'The chat background service is still starting ({stage})…',
      unreachableTitle: 'The chat background service is not responding',
      unreachableText:
        'The app cannot reach the service it keeps your chats in. ' + 'Check whether it answers again.',
      // The pre-mount screen's own wording: there the connect itself failed, so
      // there is no component to ask, and its Retry is a plain reload.
      connectFailedText:
        'The app could not connect to the service it keeps ' +
        'your chats in. If a retry does not help, close PrivacySafe ' +
        'completely and start it again.',
      stillUnreachableText:
        'The service still does not answer. Reloading this ' +
        'window will not help: it reconnects to the same background process. ' +
        'Close PrivacySafe completely and start it again.',
      failedTitle: 'The chat background service failed to start',
      failedText: 'The service reported a failed start: {reason}',
      checking: 'Checking…',
      retry: 'Retry',
      closeWindow: 'Close this window',
      listNotLoaded: 'The chat list could not be loaded.',
    },
    menu: {
      makeBackup: 'Create a backup',
      restoreBackup: 'Restore from a backup',
      exit: 'Exit',
    },
    ok: 'Ok',
    text: {
      new: 'New',
      close: 'Close',
      back: 'Back',
      next: 'Next',
      create: 'Create',
      delete: 'Delete',
      cancel: 'Cancel',
      save: 'Save',
      msg_sender: {
        you: 'You',
      },
      send: {
        file: 'file(s) sent',
      },
      receive: {
        file: 'file(s) received',
      },
    },
    notification: {
      new_message: '{sender} sent you a message',
      new_group_message: "{sender} sent a message to the '{chatName}' chat",
      invite: '{sender} invites you',
      group_invite: "{sender} invites you to the '{chatName}' chat",
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
      symlink:
        '{count} file(s) are bigger than 20 MiB and were attached by reference, so the archive ' +
        'points at them rather than holding them.',
      inIncomingMsg: '{count} file(s) belong to messages you received and stay in your mailbox on the server.',
      unreadable: '{count} file(s) could not be read.',
      folderPartial: '{count} attached folder(s) hold too many files, and only part of them is in.',
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
    // Shown by the platform's file dialogs in their file-type dropdown, so it
    // reaches the user like any other label. One key for both of them.
    zipFilterName: 'ZIP Archive',
    create: {
      dialogTitle: 'Creating backup',
      noticesTitle: 'What the archive will hold',
      noticesBtn: 'Continue',
      fileDialogTitle: 'Save backup',
      fileDialogBtn: 'Save',
      text: {
        scanning: 'Reading the chats',
        readingAttachments: 'Reading file {number} of {total}',
        compressing: 'Packing {number} of {total}',
        encrypting: 'Encrypting the archive',
        saving: 'Saving the backup file',
      },
      // Permanent explanations rather than warnings to confirm: they are not
      // about the risk of this action but about the boundary of what an archive
      // can ever bring back - said now, rather than in half a year when the
      // archive is needed.
      attachmentsNotice:
        'Files of messages you received are kept in your mailbox on the server and do not go ' +
        'into the archive. The messages themselves are restored in full.',
      thisDeviceNotice:
        'Only files that are on this device go into the archive. A message whose file was ' +
        'attached on another of your devices is backed up without it, so take the backup ' +
        'where the files are.',
      bigFilesNotice:
        'Files bigger than 20 MiB are attached by reference rather than copied, so the archive ' +
        'points at your own file instead of holding it.',
      autoDeleteNotice:
        'Chats with auto-deletion on will restore only the messages whose lifetime has not run ' + 'out yet.',
      success: 'The backup {filename} was saved.',
      skippedTitle: 'Some files did not go into the archive.',
      empty: 'There is nothing to back up.',
      cancel: 'Creating the backup was stopped.',
      error: 'The backup could not be created.',
      errorTooLarge:
        'This history is too big to be carried into an archive whole. Take a backup without ' + 'files instead.',
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
        'chats. Proceed at your own risk.',
      unknownVersion: 'unknown',
      unknownDate: 'unknown',
      skippedTitle: 'This archive does not hold every file:',
      summary: {
        createdAt: 'Backup taken',
        chats: 'Chats in the archive',
        messages: 'Messages in the archive',
        attachments: 'Files in the archive',
        currentChats: 'Chats here now',
        toCreate: 'Would be added',
        toUpdate: 'Would be updated',
        toDelete: 'Would be deleted',
        expiredSkipped: 'Past their auto-deletion time, left out',
      },
      mode: {
        mergeTitle: 'Add what is missing',
        mergeHint:
          'Chats and messages that are not here are put back. Nothing that is here is changed, ' +
          'and nothing is deleted. A message deleted after the backup stays deleted.',
        replaceTitle: 'Make the chats match the archive',
        replaceHint:
          'The archive states what the chats are. Anything you changed after the backup was ' +
          'taken still wins over it.',
        replaceWarning:
          'Chats and messages that are not in the archive, and that are older than it, will be ' +
          'deleted — on this device and on your other ones. Deleting a chat takes its whole ' +
          'history with it.',
      },
      devicesNotice:
        'Whatever you choose here is what every device of yours will do: the restore is sent ' +
        'to them and applied by the same rule.',
      text: {
        unpacking: 'Reading the archive',
        decrypting: 'Decrypting the archive',
        storingAttachments: 'Storing file {number} of {total}',
        listingInbox: 'Checking which messages are still on the server',
        restoring: 'Restoring {number} of {total}',
        announcing: 'Telling your other devices',
        completed: 'Restoration completed',
      },
      success: 'The backup was restored: {created} added, {updated} updated, {deleted} deleted.',
      expiredNotice: '{count} message(s) were left out: their auto-deletion time has passed.',
      offlineNotice:
        'The server could not be reached, so it is not known which received messages are still ' +
        'there. Some files may turn out to be unavailable.',
      error: 'The backup could not be restored.',
      errorCorruptedArchive: 'This file is damaged or is not a ZIP archive.',
      errorForeignArchive: 'This archive is a backup of another app, not of the chats.',
      errorNoChats: 'This archive holds no chats. It may be a backup of another app.',
      errorUnreadableRecords: 'The records in this archive cannot be read.',
      errorPassphraseRequired: 'This archive is encrypted and needs its passphrase.',
      errorEncryptionUnsupported: 'This archive is encrypted, and this app cannot decrypt it here.',
    },
  },

  chat: {
    months: 'months',
    days: 'days',
    hours: 'hours',
    minutes: 'minutes',
    seconds: 'seconds',
    total: 'Total',
    creating: {
      attachments: {
        remove: {
          all: 'Remove all attachments',
        },
      },
    },
    attachment: {
      dialog: {
        title: 'Attach files',
        btn: {
          select: 'Select',
        },
      },
      too_big: {
        error: 'The file {fileName} is bigger than the {limit} limit and cannot be attached',
      },
      attaching: {
        error: 'Error attaching the file {fileName}',
      },
    },
    recording: {
      dialogTitle: 'Record a message',
      label: {
        voice: 'Voice message',
        video: 'Video message',
      },
      limit: {
        voice: '15 minutes',
        video: '10 minutes',
      },
      hint: {
        choose:
          'Record straight into the chat. Pick what to record - the device ' + 'is only turned on once you do.',
        sent_at_once:
          'A recording is sent as a message of its own - you get to hear it ' +
          'first, and nothing you have typed is touched.',
        preparing: 'Turning the device on…',
        recording: 'Recording. Press Stop when you are done - it also stops on its own at the limit.',
        review: 'Listen to it, then send it or record again.',
        tap_to_unmute: 'Playing without sound - tap again to unmute.',
      },
      note: {
        limit: 'up to {limit}',
        no_microphone: 'No microphone found',
        no_camera: 'No camera found',
      },
      btn: {
        cancel: 'Cancel',
        stop: 'Stop',
        send: 'Send',
        rerecord: 'Record again',
      },
      stopped: {
        duration: 'The recording reached its time limit and stopped.',
        size:
          'The recording reached its size limit and stopped, so that it still plays ' +
          'without being downloaded in full first.',
      },
      error: {
        access_denied:
          'Access to the microphone or camera is not allowed. ' + 'Allow it in the system settings and try again.',
        no_device: 'No microphone or camera was found on this device.',
        device_busy:
          'The microphone or camera is in use by another application. ' +
          'A call in progress is the usual reason.',
        unsupported: 'Recording is not supported in this runtime.',
        failed: 'The recording failed.',
        sending: 'The recording could not be sent.',
      },
      tooltip: {
        record: 'Record a voice or video message',
      },
    },
    action: {
      menu: {
        txt: {
          info: 'Chat Info',
          refresh: 'Force-refresh chat',
          rename: 'Rename Chat',
          history: {
            export: 'Export History',
            clean: 'Clear History',
          },
          close: 'Close Chat',
          timer: {
            label: 'Auto-delete Messages',
            '0': 'off',
            '1': '1 year',
            '2': '1 month',
            '3': '1 week',
            '4': '1 day',
            '5': '1 hour',
          },
          block: 'Block User',
          unblock: 'Unblock User',
          manage_blocks: 'Manage Blocks',
          leave: 'Leave and Delete Chat',
        },
      },
    },
    create: {
      dialog: {
        title: 'Create new',
        selected: {
          contacts: 'Selected Members',
        },
      },
      group: {
        name: {
          label: 'Group Name',
        },
      },
    },
    contact: {
      add: {
        btn: 'Add {addr}',
        error: {
          exists: 'Contact {addr} already exists',
          check_failed: '{addr} is unknown address or is not present at the domain',
          unknown: 'Failed to add contact {addr}',
        },
      },
      notification: {
        blocked: {
          part1: 'You blocked {name}.',
          part2: 'They can no longer message or call you through PrivacySafe.',
        },
        unblocked: 'You unblocked {name}.',
      },
      blocked: {
        mark: 'Blocked. Unblock this contact to start a chat with them.',
        inChat: 'Blocked. Deselect to remove them from the chat.',
      },
      error: {
        block: 'Failed to block the contact',
        unblock: 'Failed to unblock the contact',
      },
    },
    content: {
      empty: 'Select a Chat to Start Messaging',
    },
    list: {
      empty: 'No chats yet',
      item: {
        created_at: 'created {date}',
      },
    },
    call: {
      startFailed:
        'Could not reach the background service to start the call. ' +
        'Try again; if it keeps failing, restart the app.',
      endFailed:
        'Could not reach the background service to end the call. ' +
        'The call state shown here may be out of date; restart the app if it persists.',
    },
    header: {
      info: 'Last post on {date}',
      call: {
        duration: 'Call duration',
      },
      btn: {
        actions: 'Actions',
      },
    },
    dialog: {
      manage_blocks: {
        title: 'Manage Blocks',
        nobody: 'No members match the search',
      },
      info: {
        title: 'Chat Info',
        auto_delete: {
          off: 'Auto-delete messages is OFF',
          txt: 'Messages in this chat will be automatically deleted after {period} from the date of sending/receiving',
        },
        users: 'Users',
        search_placeholder: 'User name',
        btn: {
          edit_members: 'Edit User List',
          back: 'Back',
          close: 'Close',
          update: 'Update',
        },
        user: {
          pending: 'Pending',
          admin: 'Admin',
        },
      },
      clean_history: {
        title: 'Clear Chat History',
      },
      export: {
        title: 'Export chat history',
      },
      rename: {
        title: 'Rename chat',
        input_placeholder: 'Enter chat name',
        btn: 'Rename',
      },
      delete: {
        title: 'Delete Chat',
        btn: 'Delete',
        text: 'Delete chat {chatName} ?',
      },
    },
    info: {
      user: {
        menu: {
          make_admin: 'Make an Admin',
          remove_admin: 'Remove from Admin',
        },
      },
    },
    app_message: {
      success: {
        export: 'The file {file} is saved.',
      },
      error: {
        export: 'Error on saving file {file}.',
        members_update: 'Error while editing chat member list',
        create_oto_chat: 'Error creating a one to one chat.',
        create_group_chat: 'Error creating a group chat.',
        // The chat is the one open in front of the user, so these name the
        // person and not the chat: its id said nothing to anybody.
        already_admin: '{user} is already an admin in this chat',
        already_not_admin: '{user} is not an admin in this chat',
        only_admin: '{user} is the only admin of this chat and cannot be removed from admins',
      },
    },
    notification: {
      noNewMessages: 'No new messages',
      callActive: {
        title: 'Active Call',
        message: 'A call is in progress in {chatName}. Tap to join.',
      },
      callEndedByHost: {
        title: 'Call Ended',
        message: 'The call initiator ended the call in {chatName}.',
      },
      callAnsweredElsewhere: {
        message: 'You answered this call on another of your devices.',
      },
      callCollision: {
        joining: '{name} called at the same moment as you. Joining their call instead.',
        unresolved: '{name} was calling you at the same moment, and the two calls did not connect. Please try calling again.',
      },
    },
    message: {
      dialog: {
        delete: {
          title: 'Delete Message',
          text: 'Delete selected message?',
          additional_text: 'Delete for everyone?',
        },
        forward: {
          title: 'Forward Message',
          section: {
            chats: {
              title: 'Chats',
              empty: 'No chats to choose from',
            },
          },
        },
        attachments_download: {
          title: 'Select a folder for downloading',
        },
        file_download: {
          title: 'Save the file',
        },
        folder_download: {
          title: 'Save the folder',
        },
      },
      input: {
        placeholder: {
          one_to_one: 'Write a message ...',
          group: 'Write a message to Group ...',
        },
      },
      menu: {
        reaction: 'Reaction',
        reply: 'Reply',
        copy: 'Copy',
        forward: 'Forward',
        edit: 'Edit',
        download: 'Download',
        resend: 'Resend',
        select: 'Select',
        info: 'Information',
        delete_message: 'Delete',
        cancel_sending: 'Cancel Sending',
      },
      label: {
        forward: 'Forwarded from',
        edit: 'Edit message:',
        unread: 'Unread messages - {messages}',
        changed: 'changed',
        sending_from_other_device: 'Sending from another device...',
      },
      reactions_dialog: {
        recent: 'Recent:',
        icons: 'Icons:',
        remove: 'Remove reaction',
        more: 'More',
        less: 'Less',
      },
      info_panel: {
        back: 'Back to the message list',
      },
      forward: {
        warning: {
          no_attachments: 'Attachments will not be forwarded: the original message is on another device',
        },
      },
      attachment: {
        not_available_on_this_device: 'Attachment is only available on the sending device',
        only_on_sending_device: 'Files are only on the sending device',
        make_preview: 'Show preview',
      },
      action_message: {
        success: {
          clipboard_copy: 'The message content was copied to clipboard',
          file_download: 'The files/folders are saved successfully',
        },
        error: {
          delete: 'An error occurred while deleting the selected message',
          file_notfound: 'The file may have been deleted or moved',
          file_download: 'The downloaded files/folders may have been deleted or moved',
          original_not_reachable: 'The original message is too far back in the history or was deleted',
        },
      },
      btn: {
        open: {
          file: 'Open file',
          folder: 'Open folder',
        },
      },
      info: {
        autodelete_off: 'This message will not be automatically deleted',
        removeAfter: 'This message will be automatically deleted in {period}',
        removeAfter_mobile: '{period} left until this message is auto-deleted',
        since: 'since',
        between: 'from {from} to {to}',
        section: {
          text: 'Text',
          reactions: 'Reactions',
          errors: 'Errors',
        },
        label: {
          now: 'Now',
          history: 'History',
          state: 'state',
        },
        text: {
          no_changes: 'There are no changes',
          no_body: 'The message does not contain a text',
          no_reactions: 'The message does not contain reactions',
          no_errors: 'The message contains no errors',
        },
        error: {
          unknownRecipient: 'unknown recipient',
          msgTooBig: 'this message is bigger than allowed',
          inboxIsFull: 'mailbox of this recipient is full',
          domainNotFound: 'this domain is not found',
          noServiceRecord: 'this domain does not support 3N',
          recipientPubKeyFailsValidation: 'the public key is not valid',
          connectError: 'cannot connect',
          noDescription: 'No description',
        },
      },
    },
    messages: {
      selected: 'Selected',
      bulk: {
        delete: 'Delete selected messages',
        exit: 'Exit bulk actions mode',
      },
      info_message: {
        autodelete: {
          set_you: 'You have set the auto-delete message timer to {value}',
          set_user: 'The {user} has set the auto-delete message timer to {value}',
          unset_you: 'You have disabled the auto-delete message timer',
          unset_user: 'The {user} has disabled the auto-delete message timer',
        },
      },
    },
    system_message: {
      rename_chat: 'The chat was renamed by',
      member_left: '{member} left this chat',
      you_are_removed: '{admin} has removed you from this chat',
      chat_deleted: '{admin} has removed this chat',
      add_members: '{admin} added {membersToAdd} to this chat, to total of {participantsNum} participants',
      add_admins: '{admin} added {adminsToAdd} to admins in this chat',
      remove_members:
        '{admin} removed {membersToDelete} from this chat, to total of {participantsNum} participants',
      remove_me: '{admin} removed me from this chat',
      remove_admins: '{admin} removed {adminsToDelete} from admins in this chat',
      add_and_remove_members:
        '{admin} removed {membersToDelete} from this chat and added {membersToAdd}, to total of {participantsNum} participants',
      add_and_remove_admins: '{admin} removed {adminsToDelete} from admins in this chat and added {adminsToAdd}',
    },
    invitation: {
      btn: {
        deny: 'Deny',
        accept: 'Accept',
      },
      message: {
        oto: {
          incoming: 'Sender with address {sender} invites you to join chat.',
          accepted: 'Sender with address {sender} invited you to join chat.',
          incoming_from_unknown: 'Unknown sender with address {sender} invites you to join chat.',
          accepted_from_unknown: 'Unknown sender with address {sender} invited you to join chat.',
          sent: 'You initiated this one-to-one chat. Messaging will be possible when other side accepts the invitation.',
        },
        group: {
          incoming: 'Sender with address {sender} invites you to join this group chat.',
          accepted: 'Sender with address {sender} invited you to join this group chat.',
          incoming_from_unknown: 'Unknown sender with address {sender} invites you to join this group chat.',
          accepted_from_unknown: 'Unknown sender with address {sender} invited you to join this group chat.',
          sent: 'You invited {members} to this group chat. Messaging will be possible when at least one of peers accepts the invitation.',
        },
        default: {
          accepted: '{name} accepted invitation to join chat.',
          sent: 'You accepted invitation to join this chat.',
        },
      },
      tooltip: {
        oto: {
          incoming_from_unknown: 'By clicking on the address {address} you will add it to your contact list',
        },
      },
    },
    viewer: {
      btn: {
        download: 'Download file',
        exit: 'Exit viewing',
        cancel_loading: 'Cancel',
        pdf: {
          prev: 'Previous page',
          next: 'Next page',
        },
      },
      label: {
        page: 'Page',
        loading: '{done} of {total}',
      },
      error: {
        cannot_play: 'This file cannot be played',
      },
      tooltip: {
        play: 'Play',
        pause: 'Pause',
        visual_setting: 'Visualization setting',
      },
      // Either side of the switch that picks how the sound is drawn.
      visualization: {
        mode1: 'Mode 1',
        mode2: 'Mode 2',
      },
    },
  },

  dialog: {
    button: {
      default: {
        cancel: 'Cancel',
      },
      block: 'Block',
      unblock: 'Unblock',
    },
    label: {
      warning: 'Warning',
    },
    text: {
      confirmation: 'Are you sure?',
      block: 'Block the user {mail}?',
      unblock: 'Unblock the user {mail}?',
    },
    additionalText: {
      block: `They will no longer be able to send you messages or call you through PrivacySafe.<br>Existing messages will remain in this conversation.`,
      unblock: 'They will be able to send you messages and call you through PrivacySafe again.',
    },
    // The file-type name the platform's open-file dialog shows in its dropdown,
    // asked for by selectImageFilesWithDialog (image-files.ts).
    'open-file': {
      'image-type': 'Images',
    },
  },

  validation: {
    text: {
      required: 'This field is required',
      length: 'No more then {length} characters',
      unknownRecipient: '{addr} is unknown address or is not present at the domain',
      inboxIsFull: 'The mailbox of {addr} is full',
      senderNotAllowed: 'An access restricted to address {addr}',
      recipientPubKeyFailsValidation: 'The public key for {addr} is not valid',
      serviceLocating: 'No service for the domain at {addr}',
      unknown: 'A network error for {addr} address',
    },
  },

  va: {
    btn: {
      end_call: 'End Call',
      rejoin_call: 'Join Call',
    },
    text: {
      call_is_active: 'A call is active. Tap to rejoin',
      call_in_progress: 'The call is on since',
      incoming_call: 'The incoming call from {sender}',
      incoming_call_cancelled: 'The incoming call from {sender} was cancelled',
      incoming_call_not_accepted: `{user} hasn't accepted the current call`,
      missed_incoming_call: 'The missed incoming call from {sender}',
      outgoing_call: 'The outgoing call',
      outgoing_call_cancelled: 'The outgoing call was cancelled',
      outgoing_call_cancelled_by: 'The outgoing call was cancelled by {user}',
      call_collision_joining: '{user} called you at the same moment. Joining their call.',
      call_collision_failed:
        'The call with {user} did not take place: you were calling each other at the same moment',
      user_left_call: '{user} left the call',
      participants: 'Participants',
      call_full: 'The call is full ({current}/{max} participants). Please try again later.',
      user_stopped_sharing: '[{user}] stopped sharing "{screen}"',
      peer_app_closed: '{user} closed the application. The call will end in a few seconds.',
      host_unreachable:
        'Cannot reach {user} anymore — the call appears to have ended. The call window will close.',
      call_setup_timeout: 'Could not connect with {user}. The call window will close.',
      invite_not_delivered: 'The invitation could not be delivered to {user}. They have not been called.',
      // The reason itself goes to the log: a JS error message is not something
      // to read in a notice.
      call_start_failed: 'The call could not be started.',
      group_call_unanswered: 'Nobody joined the call. The call window will close.',
    },
    setup: {
      title: 'Call Setup',
      notification: {
        no_cameras: 'No video cameras available',
        media_access_failed: 'Could not access the camera or microphone',
      },
      tooltip: {
        mute: 'Mute',
        unmute: 'Unmute',
        camera_off: 'Turn off the camera',
        camera_on: 'Turn on the camera',
        camera_select: 'Select WEB-cam',
      },
    },
    presettings: {
      incoming_call: 'Incoming Call from {address}',
      call_already_over: 'The call has already ended',
      btn: {
        start: 'Start Call',
        join: 'Join',
        decline: 'Decline',
      },
    },
  },

  call: {
    text: {
      participant_invited: 'Calling {user}…',
      participant_connecting: '{user} is connecting to the call…',
      participant_securing: 'Securing the connection with {user}…',
      participant_establishing: 'Establishing the connection with {user}…',
      participant_reconnecting: 'Reconnecting to {user}…',
      host: 'Call host',
      participant_no_response: '{user} is not responding',
      participant_not_reached: 'Could not deliver the invitation to {user}',
      participant_declined: '{user} declined the call',
      participant_failed: 'Could not connect to {user}',
      participant_disconnected: '{user} is disconnected',
      waiting_for_participants: 'Waiting for {count} more participant(s) to join…',
      stream_about_to_start: "{user}'s camera stream is about to start…",
      tap_to_unmute: 'Tap to enable sound',
    },
    tooltip: {
      fullscreen_mode_enable: 'Enable full-screen mode',
      fullscreen_mode_disable: 'Disable full-screen mode',
      screenshare_mode_row: 'Switch to horizontal view mode',
      screenshare_mode_column: 'Switch to vertical view mode',
      mic_on: 'Turn on the microphone',
      mic_off: 'Turn off the microphone',
      camera_on: 'Turn on the camera',
      camera_off: 'Turn off the camera',
      sharing_on: 'Open screen sharing settings',
      participants_info: 'The call participants info',
    },
    sharing: {
      title: 'Select to Share',
      desktop_sound: 'Desktop sound',
      settings: {
        sound_share: 'Share sound',
        screens_title: 'Screens',
        windows_title: 'Windows',
      },
    },
  },
};
