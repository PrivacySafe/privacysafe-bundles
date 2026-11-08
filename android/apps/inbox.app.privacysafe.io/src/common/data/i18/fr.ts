export const fr = {
  app: {
    title: 'Boîte de réception',
    status: {
      label: 'Statut',
      connected: {
        online: 'en ligne',
        offline: 'hors ligne',
      },
    },
    startup: {
      starting: 'Démarrage...',
      'migrating-db': 'Déplacement de la boîte aux lettres sur cet appareil...',
      'migrating-files': 'Déplacement des pièces jointes sur cet appareil : {done} sur {total}',
      loading: 'Chargement des messages...',
    },
    sync: {
      syncing: 'Synchronisation avec vos autres appareils…',
      syncing_count: 'Synchronisation avec vos autres appareils… ({count} restants)',
      // Said only when a pass has actually failed: this is the one state the
      // user can do something about, so it is worded as waiting rather than as
      // breakage.
      stalled: 'Des modifications sont en attente d’envoi',
    },
    select: 'Sélectionner',
    ok: 'Ok',
    new: {
      mail: 'Nouveau message',
    },
    menu: {
      refresh: "Forcer l'actualisation des données",
      manageBlocks: 'Gérer les blocs',
      makeBackup: 'Créer une sauvegarde',
      restoreBackup: 'Restaurer depuis une sauvegarde',
      exit: 'Quitter',
    },
    notification: {
      noNewMessages: 'Aucun nouveau message',
    },
    btn: {
      cancel: 'Annuler',
      save: 'Enregistrer',
      back: 'Retour',
      continue: 'Continuer',
      send: 'Envoyer',
    },
  },

  backup: {
    // One set of lines for both places the same fact is told: after a backup,
    // and before a restore of one.
    skipped: {
      onAnotherDevice:
        '{count} fichier(s) ont été joints sur un autre de vos appareils, et les données des fichiers ne transitent jamais entre les appareils.',
      notRequested: '{count} fichier(s) ont été exclus car vous avez demandé une archive sans eux.',
      external:
        "{count} fichier(s) sont trop volumineux pour être copiés et ont été joints par référence ; l'archive pointe donc vers eux au lieu de les contenir.",
      origin: '{count} fichier(s) appartiennent à des messages reçus et restent sur le serveur.',
      unreadable: "{count} fichier(s) n'ont pas pu être lus.",
      noLocalSource: "{count} fichier(s) n'ont aucun fichier lisible sur cet appareil.",
    },
    passphrase: {
      createTitle: 'Protéger la sauvegarde',
      openTitle: 'Phrase de passe requise',
      createHint:
        "Une phrase de passe chiffre l'archive. Laissez les deux champs vides pour l'enregistrer sans chiffrement.",
      openHint:
        'Cette archive de sauvegarde est chiffrée. Entrez la phrase de passe avec laquelle elle a été créée.',
      label: 'Phrase de passe',
      repeatLabel: 'Répéter la phrase de passe',
      placeholder: 'Laisser vide pour aucun chiffrement',
      openBtn: 'Ouvrir',
      show: 'Afficher la phrase de passe',
      hide: 'Masquer la phrase de passe',
      wrong: "Cette phrase de passe ne permet pas d'ouvrir cette archive.",
      mismatch: 'Les deux phrases de passe ne correspondent pas.',
      tooShort: 'Une phrase de passe doit contenir au moins {count} caractères.',
      noRecovery: "Une phrase de passe oubliée ne peut pas être récupérée : l'archive restera lisible.",
      optional:
        "Sans phrase de passe, l'archive n'est confidentielle que dans la mesure où le lieu où vous la conservez l'est.",
    },
    create: {
      dialogTitle: 'Création de la sauvegarde',
      fileDialogTitle: 'Enregistrer la sauvegarde',
      fileDialogBtn: 'Enregistrer',
      text: {
        scanning: 'Lecture de la boîte aux lettres',
        compressing: 'Compression de {number} sur {total}',
        encrypting: "Chiffrement de l'archive",
        saving: 'Enregistrement du fichier de sauvegarde',
      },
      // A permanent explanation rather than a warning to confirm: it is not
      // about the risk of this action but about the boundary of what an archive
      // can ever bring back.
      attachmentsNotice:
        'Les pièces jointes des messages reçus sont conservées sur le serveur et ne sont pas incluses dans ' +
        "l'archive. Si vous supprimez un tel message du serveur, ses pièces jointes seront perdues — les " +
        'messages eux-mêmes seront tout de même restaurés.',
      // The line a live run went without: an archive came out with no
      // attachments at all, because the files had been attached on another
      // device and file bytes never travel between devices.
      thisDeviceNotice:
        "Seuls les fichiers présents sur cet appareil sont inclus dans l'archive. Un message dont le fichier a été " +
        'joint depuis un autre de vos appareils sera sauvegardé sans celui-ci. Effectuez donc la sauvegarde ' +
        "sur l'appareil où se trouvent les fichiers.",
      success: 'La sauvegarde {filename} a été enregistrée.',
      skippedTitle: "Certains fichiers n'ont pas été inclus dans l'archive.",
      empty: "Il n'y a rien à sauvegarder.",
      cancel: 'La création de la sauvegarde a été interrompue.',
      error: 'Impossible de créer la sauvegarde.',
      errorTooLarge:
        'Cette boîte aux lettres est trop volumineuse pour être intégralement intégrée dans une archive. ' +
        'Effectuez plutôt une sauvegarde sans les pièces jointes.',
    },
    restore: {
      dialogTitle: 'Restauration de la sauvegarde',
      fileDialogTitle: 'Sélectionner le fichier de sauvegarde',
      fileDialogBtn: 'Ouvrir',
      confirmTitle: "Restaurer à partir d'une sauvegarde",
      confirmBtn: 'Restaurer',
      confirmWarningText:
        'Cette archive a été créée par la version {archiveVersion}, et cette application est en version ' +
        "{appVersion}, ou l'archive ne comporte aucune version. La restaurer peut endommager la " +
        'boîte aux lettres. Procédez à vos risques et périls.',
      unknownVersion: 'inconnue',
      unknownDate: 'inconnue',
      skippedTitle: 'Cette archive ne contient pas tous les fichiers :',
      summary: {
        createdAt: 'Sauvegarde effectuée le',
        messages: "Messages dans l'archive",
        attachments: "Pièces jointes dans l'archive",
        current: 'Messages actuellement ici',
      },
      mode: {
        mergeTitle: 'Ajouter les éléments manquants',
        mergeHint:
          'Les messages et dossiers absents sont restaurés. Rien de ce qui est présent n’est ' +
          'modifié, et rien n’est supprimé. Un message supprimé après la sauvegarde reste supprimé.',
        replaceTitle: 'Faire correspondre la boîte mail à l’archive',
        replaceHint:
          'L’archive définit le contenu de la boîte mail. Tout ce que vous avez modifié après la ' +
          'sauvegarde reste prioritaire.',
        replaceWarning:
          'Les messages et dossiers absents de l’archive et plus anciens que celle-ci seront ' +
          'supprimés — sur cet appareil et sur vos autres appareils.',
      },
      devicesNotice:
        'Le choix effectué ici s’appliquera à tous vos appareils : la restauration leur est envoyée ' +
        'et appliquée selon la même règle.',
      text: {
        unpacking: 'Lecture de l’archive',
        decrypting: 'Déchiffrement de l’archive',
        listingInbox: 'Vérification des messages encore présents sur le serveur',
        restoringAttachments: 'Restauration de la pièce jointe {number} sur {total}',
        restoringMessages: 'Restauration de {number} sur {total}',
        announcing: 'Information de vos autres appareils',
        completed: 'Restauration terminée',
      },

      success: 'Sauvegarde restaurée : {created} ajoutés, {updated} mis à jour, {deleted} supprimés.',
      offlineNotice:
        'Le serveur n’a pas pu être contacté, il est donc impossible de savoir quels messages reçus s’y trouvent encore. ' +
        'Certaines pièces jointes pourraient être indisponibles.',
      error: 'La sauvegarde n’a pas pu être restaurée.',
      errorCorruptedArchive: 'Ce fichier est endommagé ou n’est pas une archive ZIP.',
      errorForeignArchive: 'Cette archive est une sauvegarde d’une autre application, et non de la boîte mail.',
      errorNoMessages:
        'Cette archive ne contient aucun message. Il peut s’agir d’une sauvegarde d’une autre application.',
      errorUnreadableRecords: 'Les messages contenus dans cette archive ne peuvent pas être lus.',
      errorPassphraseRequired: 'Cette archive est chiffrée et nécessite sa phrase secrète.',
      errorEncryptionUnsupported:
        'Cette archive est chiffrée, mais cette application ne peut pas la déchiffrer ici.',
    },
  },

  msg: {
    create: {
      dialog: {
        title: 'Nouveau message',
      },
      label: {
        from: 'De',
        to: 'À',
        subject: 'Objet',
      },
      placeholder: {
        contacts: 'Saisissez une adresse 3NWeb ou une adresse e-mail standard',
        editor: 'Saisissez le texte du message ...',
      },
      recipient: {
        blocked: '{mail} est bloqué et a été retiré des destinataires.',
      },
      btn: {
        attach: 'Joindre des fichiers',
        editor_formating: 'Mise en forme',
        discard: 'Abandonner',
        send: 'Envoyer',
      },
      report: {
        subject: 'Rapport de la boîte de réception PrivacySafe',
      },
    },
    text: {
      no_selected: {
        part1: 'Aucun e-mail sélectionné.',
        part2: 'Sélectionnez un message pour afficher son contenu.',
      },
    },
    sending: {
      label: {
        canceled: 'Envoi annulé',
        error: 'Erreur lors de l’envoi',
        progress: 'Envoi en cours...',
      },
      error: {
        unknownRecipient: 'destinataire inconnu',
        msgTooBig: 'ce message dépasse la taille autorisée',
        inboxIsFull: 'la boîte mail de ce destinataire est pleine',
        domainNotFound: 'ce domaine est introuvable',
        noServiceRecord: 'ce domaine ne prend pas en charge 3N',
        recipientPubKeyFailsValidation: 'la clé publique est invalide',
        blocked: 'vous avez bloqué cette adresse',
        noDescription: 'Aucune description',
      },
      progress: 'Terminé à {percent} ({currentValue} sur {totalValue})',
    },
    content: {
      preflight_error: 'Le message n’a pas pu être envoyé aux destinataires spécifiés.',
      sending_on_another_device: 'Ce message est en cours d’envoi depuis un autre de vos appareils.',
      add_address: 'Ajouter l’adresse aux contacts',
      blocked_sender: 'Vous avez bloqué cette adresse',
      blocked_reply: 'Vous ne pouvez pas répondre à une adresse bloquée. Débloquez-la d’abord.',
      btn: {
        moveToTrash: 'Déplacer vers la corbeille',
        deleteForever: 'Supprimer définitivement',
        attachments_collapse: 'Réduire',
      },
      tooltip: {
        delete: 'Supprimer le message',
        resend: 'Renvoyer',
        cancel_sending: 'Annuler l’envoi',
        edit: 'Modifier',
        send: 'Envoyer',
        download: 'Télécharger le fichier',
        download_all: 'Télécharger tous les fichiers',
        view: 'Afficher le fichier',
        import_contacts: 'Importer les contacts',
        make_preview: 'Afficher un aperçu (lit le fichier entier)',
        reply: 'Répondre',
        replyAll: 'Répondre à tous',
        forward: 'Transférer',
        restore: 'Restaurer',
        // Formulé comme dans chat.app, pour la raison indiquée dans `dialog.label`.
        block: 'Bloquer l’utilisateur',
        unblock: 'Débloquer l’utilisateur',
        report: 'Signaler',
      },
      editor: {
        fontSize: 'Taille de police',
        fontSize_header: 'Titre',
        fontSize_normal: 'Normal',
        bold: 'Gras',
        unbold: 'Retirer le gras',
        italic: 'Italique',
        noItalic: 'Retirer l’italique',
        underline: 'Souligné',
        noUnderline: 'Retirer le soulignement',
        strikethrough: 'Barré',
        noStrikethrough: 'Retirer le barré',
        ordered: 'Liste numérotée',
        unordered: 'Liste à puces',
        noList: 'Supprimer la liste',
        decreaseListLevel: 'Diminuer le niveau de la liste',
        increaseListLevel: 'Augmenter le niveau de la liste',
        align_left: 'Aligner à gauche',
        align_right: 'Aligner à droite',
        align_center: 'Centrer',
        align_justify: 'Justifier',
        quote: 'Citation en bloc',
        code: 'Code',
        noCode: 'Retirer le format code',
      },
    },
    actions: {
      select_all: 'Tout sélectionner',
      deselect_all: 'Tout désélectionner',
      selected: 'Sélectionné(s)',
      cancel: 'Annuler',
      cancel_tooltip: 'Réinitialiser les messages marqués',
    },
    permanent_delete: {
      title: 'Confirmer la suppression définitive',
      string1: 'Voulez-vous vraiment supprimer définitivement le ou les messages sélectionnés ?',
      string2: 'Cette action est irréversible.',
      confirm_button: 'Supprimer définitivement',
    },
    download: {
      title: 'Sélectionner un dossier de téléchargement',
      file_title: 'Enregistrer le fichier',
    },
    preflight_dialog: {
      title: 'Vérification avant envoi',
      processing_text:
        'Préparation de l’envoi... Vérification de la disponibilité du destinataire. Veuillez patienter.',
      subtitle: 'L’adresse suivante est actuellement indisponible et les messages ne peuvent pas lui être remis :',
      question: 'Souhaitez-vous envoyer le message malgré tout ?',
      confirm_button: 'Envoyer quand même',
    },
    reply_title: 'Message original',
    forward_title: 'Message transféré',
    attachments: {
      writing: {
        success: 'Les pièces jointes ont été enregistrées',
        error: 'Erreur lors de l’enregistrement des pièces jointes',
      },
      removing: {
        error: 'Erreur lors de la suppression des pièces jointes',
      },
      linking: {
        error: 'Erreur lors de l’ouverture des pièces jointes de ce brouillon',
      },
      on_another_device:
        'Ces fichiers ont été joints depuis un autre de vos appareils et ne sont pas disponibles ici.',
      partially_downloaded:
        '{done} fichiers sur {total} enregistrés ; les autres se trouvent sur un autre de vos appareils.',
    },
    attachment: {
      import_contacts: {
        title: 'Fichier d’exportation des contacts',
        count: '{n} contact | {n} contacts',
        not_found: 'Le fichier {fileName} est introuvable',
        error: 'Les contacts n’ont pas pu être transférés vers l’application Contacts',
      },
      writing: {
        success: 'Le fichier {fileName} a été enregistré',
        error: 'Erreur lors de l’enregistrement du fichier {fileName}',
      },
      attaching: {
        error: 'Erreur lors de l’ajout du fichier {fileName} en pièce jointe',
      },
      too_big: {
        error: 'Le fichier {fileName} dépasse la limite de {limit} et ne peut pas être joint',
      },
      unavailable:
        'Le fichier {fileName} ne peut pas être lu — il semble avoir été supprimé, déplacé ou renommé. Joignez-le à nouveau pour envoyer ce message.',
      link_broken:
        'Le fichier {fileName} ne peut pas être affiché — il semble avoir été supprimé, déplacé ou renommé.',
      on_another_device:
        'Le fichier {fileName} a été joint depuis un autre de vos appareils et n’est pas disponible ici.',
      on_another_device_short: 'Sur un autre appareil',
      loading: '{done} sur {total}',
      loading_cancel: 'Annuler',
      removing: {
        error: 'Erreur lors de la suppression du fichier {fileName}',
      },
      view_exit: 'Quitter l’affichage',
    },
  },

  folder: {
    empty: {
      title: 'Le dossier est vide',
      text: {
        inbox:
          'Le dossier Boîte de réception stocke tous les e-mails entrants que vous avez reçus des services 3NWeb et des services de messagerie classiques.',
        outbox:
          'Le dossier Boîte d’envoi conserve temporairement les e-mails envoyés qui sont encore en cours de livraison.',
        draft:
          'Le dossier Brouillons contient les e-mails que vous avez commencé à rédiger sans encore les envoyer — ils sont enregistrés pour que vous puissiez les terminer et les envoyer plus tard.',
        sent: 'Le dossier Envoyés contient des copies des e-mails que vous avez envoyés avec succès à d’autres personnes.',
        trash:
          'Le dossier Corbeille conserve temporairement les e-mails supprimés. Les messages y restent jusqu’à leur suppression définitive, effectuée manuellement ou automatiquement après un certain délai.',
      },
    },
  },

  confirmation: {
    dialog: {
      text: 'Êtes-vous sûr ?',
    },
  },

  dialog: {
    'open-file': {
      'image-type': 'Images',
    },

    // Worded as in chat.app: one blacklist, told about in one voice, whichever
    // app the user happens to be blocking from.
    label: {
      warning: 'Avertissement',
    },
    button: {
      block: 'Bloquer',
      unblock: 'Débloquer',
      cancel: 'Annuler',
      close: 'Fermer',
    },
    text: {
      block: 'Bloquer l’utilisateur {mail} ?',
      unblock: 'Débloquer l’utilisateur {mail} ?',
    },
    additionalText: {
      block:
        'Cette personne ne pourra plus vous envoyer de messages ni vous appeler via PrivacySafe.' +
        '<br>Les messages existants resteront dans votre boîte mail.',
      unblock: 'Cette personne pourra à nouveau vous envoyer des messages et vous appeler via PrivacySafe.',
    },

    'report-dialog': {
      title: 'Signaler un message ou un expéditeur',
      // On the phone the form is a page, and the line above does not fit
      // between the arrow back and the button that sends.
      pageTitle: 'Signaler',
      content: {
        'reasons-label': 'Dites-nous pourquoi vous souhaitez le signaler.',
        reason: {
          label: 'Motif',
          spam: 'Spam',
          harassment: 'Harcèlement ou menaces',
          fraud: 'Usurpation d’identité ou fraude',
          activity: 'Activité nuisible ou illégale',
          other: 'Autre',
        },
        fieldsetLabel:
          'Cela transmettra le contenu du message signalé à l’équipe chargée des abus de PrivacySafe.',
        reportedMessage: 'Inclure le message signalé ?',
        reportedAttachments: 'Inclure les pièces jointes du message signalé ?',
        step2SubTitle: 'Votre message de signalement',
        step2Preamble: 'Je souhaite signaler un message ou un expéditeur de PrivacySafe Inbox.',
        step2Additional: 'Informations complémentaires',
        step2Block: 'Souhaitez-vous également bloquer cet expéditeur ?',
        // Who is being reported, and when their message came, are in every
        // report: the toggle above discloses the contents of the message, and a
        // complaint about nobody is one the abuse team can do nothing with.
        reportedSender: 'Expéditeur signalé',
        reportedReceivedAt: 'Reçu le',
        reportedMsgId: 'Identifiant du message',
        reportedMessageTitle: 'Message signalé',
        attachmentsNote: 'Les pièces jointes du message signalé sont jointes à ce signalement.',
        attachmentsFailed: 'Les pièces jointes suivantes du message signalé n’ont pas pu être jointes : {files}',
      },
      notif: {
        noReportAddress: 'Erreur lors de la récupération de l’adresse de destination du signalement',
        reportAddressBlocked:
          'Vous avez bloqué {mail}, l’adresse à laquelle les signalements de ce domaine sont envoyés. Débloquez-la pour pouvoir signaler.',
        blocked: '{mail} a été bloqué',
        attachmentsError: 'Certaines pièces jointes du message signalé n’ont pas pu être jointes au signalement',
        sending: 'Le signalement est en cours d’envoi. Sa progression est visible dans la boîte d’envoi.',
        sent: 'Le signalement a été envoyé',
        sendError: 'Le signalement n’a pas pu être envoyé',
      },
    },
  },

  manageBlocks: {
    dialog: {
      title: 'Gérer les blocages',
      search_placeholder: 'Rechercher par nom ou adresse',
      section: {
        contacts: 'Contacts',
        used: 'Absents des contacts',
      },
      nobody: 'Aucun résultat correspondant à la recherche',
    },
  },

  contact: {
    // Said on a row the recipient list shows but refuses to pick, as chat.app
    // says it on a contact it will not start a chat with.
    blocked: {
      mark: 'Bloqué',
    },
    error: {
      block: 'Échec du blocage du contact',
      unblock: 'Échec du déblocage du contact',
    },
  },

  chat: {
    pdf: {
      view: {
        btn: {
          prev: 'Page précédente',
          next: 'Page suivante',
        },
        page: 'Page',
      },
    },
    player: {
      play: 'Lire',
      pause: 'Mettre en pause',
    },
    audio: {
      player: {
        visual: {
          setting: 'Paramètres de visualisation',
          mode1: 'Mode 1',
          mode2: 'Mode 2',
        },
      },
    },
    view: {
      load: {
        file: {
          error: 'Erreur lors du chargement du fichier',
        },
      },
    },
  },
};
