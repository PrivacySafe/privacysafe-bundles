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

export const fr = {
  app: {
    title: 'Chat',
    status: {
      label: 'Statut',
      connected: {
        online: 'En ligne',
        offline: 'Hors ligne',
      },
    },
    sync: {
      label: 'Synchronisation…',
      labelWithCount: 'Synchronisation… ({count})',
      catchUp: 'Récupération des messages…',
      stalled: 'Des modifications sont en attente d’envoi',
      stalledTooltip:
        'Les modifications effectuées ici ne sont pas encore parvenues à vos autres appareils ; ' +
        'elles sont conservées et seront renvoyées',
      tooltip: {
        idle: '',
        'catch-up': 'Récupération des messages reçus pendant la fermeture de l’application',
        incoming: 'Application des modifications effectuées sur vos autres appareils',
        outgoing: 'Envoi des modifications à vos autres appareils',
      },
      duplicateInstance:
        'Une autre instance de l’application utilise le même dossier de données, ' +
        'les deux instances sont donc considérées comme le même appareil et ne peuvent pas se synchroniser entre elles. ' +
        'Démarrez la deuxième instance avec son propre dossier de données.',
    },
    orientation: {
      rotateBack: 'Veuillez remettre votre téléphone en mode portrait',
    },
    startup: {
      starting: 'Démarrage…',
      stillStarting: 'Le service de discussion en arrière-plan est toujours en cours de démarrage ({stage})…',
      unreachableTitle: 'Le service de discussion en arrière-plan ne répond pas',
      unreachableText:
        'L’application ne parvient pas à joindre le service qui stocke vos discussions. ' +
        'Vérifiez s’il répond de nouveau.',
      // The pre-mount screen's own wording: there the connect itself failed, so
      // there is no component to ask, and its Retry is a plain reload.
      connectFailedText:
        'L’application n’a pas pu se connecter au service qui stocke ' +
        'vos discussions. Si une nouvelle tentative ne fonctionne pas, fermez complètement PrivacySafe ' +
        'et redémarrez-le.',
      stillUnreachableText:
        'Le service ne répond toujours pas. Recharger cette ' +
        'fenêtre ne changera rien : elle se reconnectera au même processus en arrière-plan. ' +
        'Fermez complètement PrivacySafe et redémarrez-le.',
      failedTitle: 'Échec du démarrage du service de discussion en arrière-plan',
      failedText: 'Le service a signalé un échec au démarrage : {reason}',
      checking: 'Vérification…',
      retry: 'Réessayer',
      closeWindow: 'Fermer cette fenêtre',
      listNotLoaded: 'Impossible de charger la liste des discussions.',
    },
    menu: {
      makeBackup: 'Créer une sauvegarde',
      restoreBackup: 'Restaurer à partir d’une sauvegarde',
      exit: 'Quitter',
    },
    ok: 'OK',
    text: {
      new: 'Nouveau',
      close: 'Fermer',
      back: 'Retour',
      next: 'Suivant',
      create: 'Créer',
      delete: 'Supprimer',
      search: 'Rechercher',
      cancel: 'Annuler',
      save: 'Enregistrer',
      msg_sender: {
        you: 'Vous',
      },
      send: {
        file: 'fichier(s) envoyé(s)',
      },
      receive: {
        file: 'fichier(s) reçu(s)',
      },
    },
    notification: {
      new_message: '{sender} vous a envoyé un message',
      new_group_message: '{sender} a envoyé un message dans la discussion « {chatName} »',
      invite: '{sender} vous invite',
      group_invite: '{sender} vous invite dans la discussion « {chatName} »',
    },
  },

  backup: {
    // One set of lines for both places the same fact is told: after a backup,
    // and before a restore of one.
    skipped: {
      onAnotherDevice:
        '{count} fichier(s) ont été joints sur un autre de vos appareils, et les données des fichiers ne sont jamais transférées entre les appareils.',
      notRequested: '{count} fichier(s) ont été exclus, car vous avez demandé une archive sans ces fichiers.',
      symlink:
        '{count} fichier(s) dépassent 20 Mio et ont été joints sous forme de références ; l’archive pointe donc vers ces fichiers au lieu de les contenir.',
      inIncomingMsg:
        '{count} fichier(s) appartiennent à des messages que vous avez reçus et restent dans votre boîte de réception sur le serveur.',
      unreadable: '{count} fichier(s) n’ont pas pu être lus.',
      folderPartial:
        '{count} dossier(s) joint(s) contiennent trop de fichiers ; seule une partie de leur contenu a été incluse.',
      noLocalSource: '{count} fichier(s) ne disposent d’aucune copie lisible sur cet appareil.',
    },
    passphrase: {
      createTitle: 'Protéger la sauvegarde',
      openTitle: 'Phrase secrète requise',
      createHint:
        'Une phrase secrète chiffre l’archive. Laissez les deux champs vides pour l’enregistrer sans chiffrement.',
      openHint:
        'Cette archive de sauvegarde est chiffrée. Saisissez la phrase secrète utilisée lors de sa création.',
      label: 'Phrase secrète',
      repeatLabel: 'Répéter la phrase secrète',
      placeholder: 'Laisser vide pour ne pas chiffrer',
      openBtn: 'Ouvrir',
      show: 'Afficher la phrase secrète',
      hide: 'Masquer la phrase secrète',
      wrong: 'Cette phrase secrète ne permet pas d’ouvrir cette archive.',
      mismatch: 'Les deux phrases secrètes ne correspondent pas.',
      tooShort: 'La phrase secrète doit contenir au moins {count} caractères.',
      noRecovery: 'Une phrase secrète oubliée ne peut pas être récupérée : l’archive restera illisible.',
      optional:
        'Sans phrase secrète, la confidentialité de l’archive dépend uniquement de l’endroit où vous la conservez.',
    },
    // Shown by the platform's file dialogs in their file-type dropdown, so it
    // reaches the user like any other label. One key for both of them.
    zipFilterName: 'Archive ZIP',
    create: {
      dialogTitle: 'Création de la sauvegarde',
      noticesTitle: 'Contenu de l’archive',
      noticesBtn: 'Continuer',
      fileDialogTitle: 'Enregistrer la sauvegarde',
      fileDialogBtn: 'Enregistrer',
      text: {
        scanning: 'Lecture des discussions',
        readingAttachments: 'Lecture du fichier {number} sur {total}',
        compressing: 'Compression du fichier {number} sur {total}',
        encrypting: 'Chiffrement de l’archive',
        saving: 'Enregistrement du fichier de sauvegarde',
      },
      // Permanent explanations rather than warnings to confirm: they are not
      // about the risk of this action but about the boundary of what an archive
      // can ever bring back - said now, rather than in half a year when the
      // archive is needed.
      attachmentsNotice:
        'Les fichiers des messages que vous avez reçus sont conservés dans votre boîte de réception sur le serveur et ne sont pas inclus dans l’archive. Les messages eux-mêmes sont restaurés intégralement.',
      thisDeviceNotice:
        'Seuls les fichiers présents sur cet appareil sont inclus dans l’archive. Un message dont le fichier a été joint depuis un autre de vos appareils est sauvegardé sans ce fichier. Effectuez donc la sauvegarde depuis l’appareil où se trouvent les fichiers.',
      bigFilesNotice:
        'Les fichiers de plus de 20 Mio sont joints sous forme de références plutôt que copiés. L’archive pointe donc vers vos propres fichiers au lieu de les contenir.',
      autoDeleteNotice:
        'Les discussions dont la suppression automatique est activée ne restaureront que les messages dont la durée de conservation n’est pas encore écoulée.',
      success: 'La sauvegarde {filename} a été enregistrée.',
      skippedTitle: 'Certains fichiers n’ont pas été inclus dans l’archive.',
      empty: 'Il n’y a rien à sauvegarder.',
      cancel: 'La création de la sauvegarde a été interrompue.',
      error: 'Impossible de créer la sauvegarde.',
      errorTooLarge:
        'Cet historique est trop volumineux pour être entièrement inclus dans une archive. Effectuez plutôt une sauvegarde sans fichiers.',
    },
    restore: {
      dialogTitle: 'Restauration de la sauvegarde',
      fileDialogTitle: 'Sélectionner un fichier de sauvegarde',
      fileDialogBtn: 'Ouvrir',
      confirmTitle: 'Restaurer à partir d’une sauvegarde',
      confirmBtn: 'Restaurer',
      confirmWarningText:
        'Cette archive a été créée avec la version {archiveVersion}, tandis que cette application utilise la version ' +
        '{appVersion}, ou bien l’archive ne contient aucune information de version. La restauration risque d’endommager les ' +
        'discussions. Procédez à vos risques et périls.',
      unknownVersion: 'inconnue',
      unknownDate: 'inconnue',
      skippedTitle: 'Cette archive ne contient pas tous les fichiers :',
      summary: {
        createdAt: 'Sauvegarde effectuée le',
        chats: 'Discussions dans l’archive',
        messages: 'Messages dans l’archive',
        attachments: 'Fichiers dans l’archive',
        currentChats: 'Discussions actuelles',
        toCreate: 'Seront ajoutées',
        toUpdate: 'Seront mises à jour',
        toDelete: 'Seront supprimées',
        expiredSkipped: 'Messages dont la durée avant suppression automatique est écoulée, exclus',
      },
      mode: {
        mergeTitle: 'Ajouter les éléments manquants',
        mergeHint:
          'Les discussions et les messages absents seront restaurés. Rien de ce qui est déjà présent ne sera modifié ni supprimé. Un message supprimé après la sauvegarde restera supprimé.',
        replaceTitle: 'Synchroniser les discussions avec l’archive',
        replaceHint:
          'L’archive définit l’état des discussions. Toute modification effectuée après la création de la sauvegarde sera toutefois conservée.',
        replaceWarning:
          'Les discussions et les messages absents de l’archive et antérieurs à celle-ci seront supprimés, sur cet appareil et sur vos autres appareils. La suppression d’une discussion entraîne la suppression de tout son historique.',
      },
      devicesNotice:
        'Le choix effectué ici sera appliqué sur tous vos appareils : la restauration leur sera transmise et appliquée selon la même règle.',
      text: {
        unpacking: 'Lecture de l’archive',
        decrypting: 'Déchiffrement de l’archive',
        storingAttachments: 'Enregistrement du fichier {number} sur {total}',
        listingInbox: 'Vérification des messages encore présents sur le serveur',
        restoring: 'Restauration de {number} sur {total}',
        announcing: 'Notification de vos autres appareils',
        completed: 'Restauration terminée',
      },
      success: 'Sauvegarde restaurée : {created} ajoutée(s), {updated} mise(s) à jour, {deleted} supprimée(s).',
      expiredNotice: '{count} message(s) ont été exclus : leur délai de suppression automatique est écoulé.',
      offlineNotice:
        'Impossible de joindre le serveur ; il est donc impossible de savoir quels messages reçus y sont encore présents. Certains fichiers pourraient être indisponibles.',
      error: 'Impossible de restaurer la sauvegarde.',
      errorCorruptedArchive: 'Ce fichier est endommagé ou ne constitue pas une archive ZIP.',
      errorForeignArchive: 'Cette archive est une sauvegarde d’une autre application, et non des discussions.',
      errorNoChats:
        'Cette archive ne contient aucune discussion. Il peut s’agir d’une sauvegarde d’une autre application.',
      errorUnreadableRecords: 'Impossible de lire les données contenues dans cette archive.',
      errorPassphraseRequired: 'Cette archive est chiffrée et nécessite sa phrase secrète.',
      errorEncryptionUnsupported:
        'Cette archive est chiffrée, mais cette application ne peut pas la déchiffrer ici.',
    },
  },

  chat: {
    months: 'mois',
    days: 'jours',
    hours: 'heures',
    minutes: 'minutes',
    seconds: 'secondes',
    total: 'Total',
    creating: {
      attachments: {
        remove: {
          all: 'Supprimer toutes les pièces jointes',
        },
      },
    },
    attachment: {
      dialog: {
        title: 'Joindre des fichiers',
        btn: {
          select: 'Sélectionner',
        },
      },
      too_big: {
        error: 'Le fichier {fileName} dépasse la limite de {limit} et ne peut pas être joint.',
      },
      external_draft: {
        error: 'Erreur lors de la pièce jointe de fichiers provenant d’une autre application.',
      },
      import_contacts: {
        title: 'Fichier d’exportation des contacts',
        count: '{n} contact | {n} contacts',
        save_tooltip: 'Enregistrer le fichier',
        tooltip: 'Importer des contacts',
        error: 'Impossible de transférer les contacts vers l’application Contacts',
      },
      attaching: {
        error: 'Erreur lors de la pièce jointe du fichier {fileName}',
      },
    },
    recording: {
      dialogTitle: 'Enregistrer un message',
      label: {
        voice: 'Message vocal',
        video: 'Message vidéo',
      },
      limit: {
        voice: '15 minutes',
        video: '10 minutes',
      },
      hint: {
        choose:
          'Enregistrez directement dans la discussion. Choisissez ce que vous souhaitez enregistrer : ' +
          'l’appareil ne sera activé qu’une fois votre choix effectué.',
        sent_at_once:
          'Un enregistrement est envoyé comme un message distinct : vous pouvez d’abord l’écouter, ' +
          'et rien de ce que vous avez écrit ne sera modifié.',
        preparing: 'Activation de l’appareil…',
        recording:
          'Enregistrement en cours. Appuyez sur Arrêter lorsque vous avez terminé ; l’enregistrement s’arrête également automatiquement à la limite de durée.',
        review: 'Écoutez l’enregistrement, puis envoyez-le ou recommencez.',
        tap_to_unmute: 'Lecture sans son : appuyez à nouveau pour réactiver le son.',
      },
      note: {
        limit: 'jusqu’à {limit}',
        no_microphone: 'Aucun microphone détecté',
        no_camera: 'Aucune caméra détectée',
      },
      btn: {
        cancel: 'Annuler',
        stop: 'Arrêter',
        send: 'Envoyer',
        rerecord: 'Enregistrer à nouveau',
      },
      stopped: {
        duration: 'L’enregistrement a atteint sa durée maximale et s’est arrêté.',
        size:
          'L’enregistrement a atteint sa taille maximale et s’est arrêté afin de pouvoir être lu ' +
          'sans devoir être entièrement téléchargé au préalable.',
      },
      error: {
        access_denied:
          'L’accès au microphone ou à la caméra n’est pas autorisé. ' +
          'Autorisez-le dans les paramètres système, puis réessayez.',
        no_device: 'Aucun microphone ni aucune caméra n’a été détecté sur cet appareil.',
        device_busy:
          'Le microphone ou la caméra est utilisé par une autre application. ' +
          'Un appel en cours en est généralement la cause.',
        unsupported: 'L’enregistrement n’est pas pris en charge dans cet environnement.',
        failed: 'L’enregistrement a échoué.',
        sending: 'Impossible d’envoyer l’enregistrement.',
      },
      tooltip: {
        record: 'Enregistrer un message vocal ou vidéo',
      },
    },
    action: {
      menu: {
        txt: {
          info: 'Informations sur la discussion',
          refresh: 'Actualiser la discussion de force',
          rename: 'Renommer la discussion',
          history: {
            export: 'Exporter l’historique',
            clean: 'Effacer l’historique',
          },
          close: 'Fermer la discussion',
          timer: {
            label: 'Suppression automatique des messages',
            '0': 'Désactivée',
            '1': '1 an',
            '2': '1 mois',
            '3': '1 semaine',
            '4': '1 jour',
            '5': '1 heure',
          },
          block: 'Bloquer l’utilisateur',
          unblock: 'Débloquer l’utilisateur',
          manage_blocks: 'Gérer les blocages',
          leave: 'Quitter et supprimer la discussion',
        },
      },
    },
    create: {
      dialog: {
        title: 'Créer une nouvelle discussion',
        selected: {
          contacts: 'Membres sélectionnés',
        },
      },
      group: {
        name: {
          label: 'Nom du groupe',
        },
      },
    },
    contact: {
      add: {
        btn: 'Ajouter {addr}',
        error: {
          exists: 'Le contact {addr} existe déjà',
          check_failed: '{addr} est une adresse inconnue ou n’est pas présente sur ce domaine',
          unknown: 'Impossible d’ajouter le contact {addr}',
        },
      },
      notification: {
        blocked: {
          part1: 'Vous avez bloqué {name}.',
          part2: 'Cette personne ne peut plus vous envoyer de messages ni vous appeler via PrivacySafe.',
        },
        unblocked: 'Vous avez débloqué {name}.',
      },
      blocked: {
        mark: 'Bloqué. Débloquez ce contact pour démarrer une discussion avec lui.',
        inChat: 'Bloqué. Désélectionnez ce contact pour le retirer de la discussion.',
      },
      error: {
        block: 'Échec du blocage du contact',
        unblock: 'Échec du déblocage du contact',
      },
    },
    content: {
      empty: 'Sélectionnez une discussion pour commencer à échanger des messages',
    },
    list: {
      empty: 'Aucune discussion pour l’instant',
      item: {
        created_at: 'créé le {date}',
      },
    },
    call: {
      startFailed:
        'Impossible de contacter le service en arrière-plan pour démarrer l’appel. ' +
        'Veuillez réessayer ; si le problème persiste, redémarrez l’application.',
      endFailed:
        'Impossible de contacter le service en arrière-plan pour terminer l’appel. ' +
        'L’état de l’appel affiché ici peut ne pas être à jour ; redémarrez l’application si le problème persiste.',
    },
    header: {
      info: 'Dernière publication le {date}',
      call: {
        duration: 'Durée de l’appel',
      },
      btn: {
        actions: 'Actions',
      },
    },
    dialog: {
      manage_blocks: {
        title: 'Gérer les blocages',
        nobody: 'Aucun membre ne correspond à la recherche',
      },
      info: {
        title: 'Informations sur le chat',
        auto_delete: {
          off: 'La suppression automatique des messages est désactivée',
          txt: 'Les messages de cette conversation seront automatiquement supprimés après {period} à compter de leur date d’envoi ou de réception',
        },
        users: 'Utilisateurs',
        search_placeholder: 'Nom d’utilisateur',
        btn: {
          edit_members: 'Modifier la liste des utilisateurs',
          back: 'Retour',
          close: 'Fermer',
          update: 'Mettre à jour',
        },
        user: {
          pending: 'En attente',
          admin: 'Administrateur',
        },
      },
      clean_history: {
        title: 'Effacer l’historique du chat',
      },
      export: {
        title: 'Exporter l’historique du chat',
      },
      rename: {
        title: 'Renommer le chat',
        input_placeholder: 'Saisissez le nom du chat',
        btn: 'Renommer',
      },
      delete: {
        title: 'Supprimer le chat',
        btn: 'Supprimer',
        text: 'Supprimer le chat {chatName} ?',
      },
    },
    info: {
      user: {
        menu: {
          make_admin: 'Nommer administrateur',
          remove_admin: 'Retirer le rôle d’administrateur',
        },
      },
    },
    app_message: {
      success: {
        export: 'Le fichier {file} est enregistré.',
      },
      error: {
        export: 'Erreur lors de l’enregistrement du fichier {file}.',
        members_update: 'Erreur lors de la modification de la liste des membres du chat.',
        search: 'Erreur lors de la recherche de messages dans le chat.',
        create_oto_chat: 'Erreur lors de la création d’un chat privé.',
        create_group_chat: 'Erreur lors de la création d’un chat de groupe.',
        // The chat is the one open in front of the user, so these name the
        // person and not the chat: its id said nothing to anybody.
        already_admin: '{user} est déjà administrateur de ce chat',
        already_not_admin: '{user} n’est pas administrateur de ce chat',
        only_admin: '{user} est le seul administrateur de ce chat et ne peut pas être retiré des administrateurs',
      },
    },
    notification: {
      noNewMessages: 'Aucun nouveau message',
      callActive: {
        title: 'Appel en cours',
        message: 'Un appel est en cours dans {chatName}. Appuyez pour le rejoindre.',
      },
      callEndedByHost: {
        title: 'Appel terminé',
        message: 'L’initiateur de l’appel a mis fin à l’appel dans {chatName}.',
      },
      callAnsweredElsewhere: {
        message: 'Vous avez répondu à cet appel sur un autre de vos appareils.',
      },
      callCollision: {
        joining: '{name} vous a appelé au même moment. Vous rejoignez son appel à la place.',
        unresolved:
          '{name} vous a appelé au même moment, mais les deux appels n’ont pas pu être connectés. Veuillez réessayer.',
      },
    },
    message: {
      dialog: {
        delete: {
          title: 'Supprimer le message',
          text: 'Supprimer le message sélectionné ?',
          additional_text: 'Supprimer pour tout le monde ?',
        },
        forward: {
          title: 'Transférer le message',
          section: {
            chats: {
              title: 'Chats',
              empty: 'Aucun chat disponible',
            },
          },
        },
        attachments_download: {
          title: 'Sélectionner un dossier de téléchargement',
        },
        file_download: {
          title: 'Enregistrer le fichier',
        },
        folder_download: {
          title: 'Enregistrer le dossier',
        },
      },
      input: {
        placeholder: {
          one_to_one: 'Écrire un message...',
          group: 'Écrire un message au groupe...',
        },
      },
      menu: {
        reaction: 'Réagir',
        reply: 'Répondre',
        copy: 'Copier',
        forward: 'Transférer',
        edit: 'Modifier',
        download: 'Télécharger',
        resend: 'Renvoyer',
        select: 'Sélectionner',
        info: 'Informations',
        delete_message: 'Supprimer',
        cancel_sending: 'Annuler l’envoi',
      },
      label: {
        forward: 'Transféré depuis',
        edit: 'Modifier le message :',
        unread: 'Messages non lus - {messages}',
        changed: 'modifié',
        sending_from_other_device: 'Envoi depuis un autre appareil...',
      },
      reactions_dialog: {
        recent: 'Récents :',
        icons: 'Icônes :',
        remove: 'Supprimer la réaction',
        more: 'Plus',
        less: 'Moins',
      },
      info_panel: {
        back: 'Retour à la liste des messages',
      },
      forward: {
        warning: {
          no_attachments:
            'Les pièces jointes ne seront pas transférées : le message d’origine se trouve sur un autre appareil',
        },
      },
      attachment: {
        not_available_on_this_device: 'La pièce jointe est uniquement disponible sur l’appareil d’envoi',
        only_on_sending_device: 'Les fichiers se trouvent uniquement sur l’appareil d’envoi',
        make_preview: 'Afficher l’aperçu',
      },
      action_message: {
        success: {
          clipboard_copy: 'Le contenu du message a été copié dans le presse-papiers',
          file_download: 'Les fichiers/dossiers ont été enregistrés avec succès',
        },
        error: {
          delete: 'Une erreur est survenue lors de la suppression du message sélectionné',
          file_notfound: 'Le fichier a peut-être été supprimé ou déplacé',
          file_download: 'Les fichiers/dossiers téléchargés ont peut-être été supprimés ou déplacés',
          original_not_reachable: 'Le message d’origine est trop ancien dans l’historique ou a été supprimé',
        },
      },
      btn: {
        open: {
          file: 'Ouvrir le fichier',
          folder: 'Ouvrir le dossier',
        },
      },
      info: {
        autodelete_off: 'Ce message ne sera pas supprimé automatiquement',
        removeAfter: 'Ce message sera automatiquement supprimé dans {period}',
        removeAfter_mobile: 'Temps restant avant la suppression automatique de ce message : {period}',
        since: 'depuis',
        between: 'du {from} au {to}',
        section: {
          text: 'Texte',
          reactions: 'Réactions',
          errors: 'Erreurs',
        },
        label: {
          now: 'Maintenant',
          history: 'Historique',
          state: 'état',
        },
        text: {
          no_changes: 'Aucune modification',
          no_body: 'Le message ne contient aucun texte',
          no_reactions: 'Le message ne contient aucune réaction',
          no_errors: 'Le message ne contient aucune erreur',
        },
        error: {
          unknownRecipient: 'destinataire inconnu',
          msgTooBig: 'ce message dépasse la taille autorisée',
          inboxIsFull: 'la boîte de réception de ce destinataire est pleine',
          domainNotFound: 'ce domaine est introuvable',
          noServiceRecord: 'ce domaine ne prend pas en charge 3N',
          recipientPubKeyFailsValidation: 'la clé publique n’est pas valide',
          connectError: 'connexion impossible',
          noDescription: 'Aucune description',
        },
      },
    },
    messages: {
      selected: 'Sélectionnés',
      bulk: {
        delete: 'Supprimer les messages sélectionnés',
        exit: 'Quitter le mode d’actions groupées',
      },
      info_message: {
        autodelete: {
          set_you: 'Vous avez défini le délai de suppression automatique des messages sur {value}',
          set_user: '{user} a défini le délai de suppression automatique des messages sur {value}',
          unset_you: 'Vous avez désactivé la suppression automatique des messages',
          unset_user: '{user} a désactivé la suppression automatique des messages',
        },
      },
    },
    system_message: {
      rename_chat: 'Le chat a été renommé par',
      member_left: '{member} a quitté ce chat',
      you_are_removed: '{admin} vous a retiré de ce chat',
      chat_deleted: '{admin} a supprimé ce chat',
      add_members:
        '{admin} a ajouté {membersToAdd} à ce chat, qui compte désormais {participantsNum} participants',
      add_admins: '{admin} a ajouté {adminsToAdd} aux administrateurs de ce chat',
      remove_members:
        '{admin} a retiré {membersToDelete} de ce chat, qui compte désormais {participantsNum} participants',
      remove_me: '{admin} m’a retiré de ce chat',
      remove_admins: '{admin} a retiré {adminsToDelete} des administrateurs de ce chat',
      add_and_remove_members:
        '{admin} a retiré {membersToDelete} de ce chat et ajouté {membersToAdd}, qui compte désormais {participantsNum} participants',
      add_and_remove_admins:
        '{admin} a retiré {adminsToDelete} des administrateurs de ce chat et ajouté {adminsToAdd}',
    },
    invitation: {
      btn: {
        deny: 'Refuser',
        accept: 'Accepter',
      },
      message: {
        oto: {
          incoming: 'L’expéditeur à l’adresse {sender} vous invite à rejoindre le chat.',
          accepted: 'L’expéditeur à l’adresse {sender} vous a invité à rejoindre le chat.',
          incoming_from_unknown: 'Un expéditeur inconnu à l’adresse {sender} vous invite à rejoindre le chat.',
          accepted_from_unknown: 'Un expéditeur inconnu à l’adresse {sender} vous a invité à rejoindre le chat.',
          sent: 'Vous avez initié ce chat privé. Vous pourrez envoyer des messages lorsque votre correspondant aura accepté l’invitation.',
        },
        group: {
          incoming: 'L’expéditeur à l’adresse {sender} vous invite à rejoindre ce groupe de discussion.',
          accepted: 'L’expéditeur à l’adresse {sender} vous a invité à rejoindre ce groupe de discussion.',
          incoming_from_unknown:
            'Un expéditeur inconnu à l’adresse {sender} vous invite à rejoindre ce groupe de discussion.',
          accepted_from_unknown:
            'Un expéditeur inconnu à l’adresse {sender} vous a invité à rejoindre ce groupe de discussion.',
          sent: 'Vous avez invité {members} à rejoindre ce groupe de discussion. Vous pourrez envoyer des messages dès qu’au moins un participant aura accepté l’invitation.',
        },
        default: {
          accepted: '{name} a accepté l’invitation à rejoindre le chat.',
          sent: 'Vous avez accepté l’invitation à rejoindre ce chat.',
        },
      },
      tooltip: {
        oto: {
          incoming_from_unknown: 'En cliquant sur l’adresse {address}, vous l’ajouterez à votre liste de contacts',
        },
      },
    },
    viewer: {
      btn: {
        download: 'Télécharger le fichier',
        exit: 'Quitter l’affichage',
        cancel_loading: 'Annuler',
        pdf: {
          prev: 'Page précédente',
          next: 'Page suivante',
        },
      },
      label: {
        page: 'Page',
        loading: '{done} sur {total}',
      },
      error: {
        cannot_play: 'Impossible de lire ce fichier',
      },
      tooltip: {
        play: 'Lire',
        pause: 'Mettre en pause',
        visual_setting: 'Paramètres d’affichage',
      },
      // Either side of the switch that picks how the sound is drawn.
      visualization: {
        mode1: 'Mode 1',
        mode2: 'Mode 2',
      },
    },
    search: {
      results: 'Résultats',
    },
  },

  dialog: {
    button: {
      default: {
        cancel: 'Annuler',
      },
      block: 'Bloquer',
      unblock: 'Débloquer',
    },
    label: {
      warning: 'Avertissement',
    },
    text: {
      confirmation: 'Êtes-vous sûr ?',
      block: 'Bloquer l’utilisateur {mail} ?',
      unblock: 'Débloquer l’utilisateur {mail} ?',
    },
    additionalText: {
      block: `Il ne pourra plus vous envoyer de messages ni vous appeler via PrivacySafe.<br>Les messages existants resteront dans cette conversation.`,
      unblock: 'Il pourra à nouveau vous envoyer des messages et vous appeler via PrivacySafe.',
    },
    // The file-type name the platform's open-file dialog shows in its dropdown,
    // asked for by selectImageFilesWithDialog (image-files.ts).
    'open-file': {
      'image-type': 'Images',
    },
  },

  validation: {
    text: {
      required: 'Ce champ est obligatoire',
      length: 'Pas plus de {length} caractères',
      unknownRecipient: '{addr} est une adresse inconnue ou n’existe pas sur ce domaine',
      inboxIsFull: 'La boîte de réception de {addr} est pleine',
      senderNotAllowed: 'L’accès est restreint pour l’adresse {addr}',
      recipientPubKeyFailsValidation: 'La clé publique de {addr} n’est pas valide',
      serviceLocating: 'Aucun service disponible pour le domaine de {addr}',
      unknown: 'Une erreur réseau est survenue pour l’adresse {addr}',
    },
  },

  va: {
    btn: {
      end_call: 'Terminer l’appel',
      rejoin_call: 'Rejoindre l’appel',
    },
    text: {
      call_is_active: 'Un appel est en cours. Appuyez pour le rejoindre',
      call_in_progress: 'L’appel est en cours depuis',
      incoming_call: 'Appel entrant de {sender}',
      incoming_call_cancelled: 'L’appel entrant de {sender} a été annulé',
      incoming_call_not_accepted: `{user} n’a pas accepté l’appel en cours`,
      missed_incoming_call: 'Appel entrant manqué de {sender}',
      outgoing_call: 'Appel sortant',
      outgoing_call_cancelled: 'L’appel sortant a été annulé',
      outgoing_call_cancelled_by: 'L’appel sortant a été annulé par {user}',
      call_collision_joining: '{user} vous a appelé au même moment. Vous rejoignez son appel.',
      call_collision_failed: 'L’appel avec {user} n’a pas pu avoir lieu : vous vous êtes appelés au même moment',
      user_left_call: '{user} a quitté l’appel',
      participants: 'Participants',
      call_full: 'L’appel est complet ({current}/{max} participants). Veuillez réessayer plus tard.',
      user_stopped_sharing: '[{user}] a arrêté de partager « {screen} »',
      peer_app_closed: '{user} a fermé l’application. L’appel prendra fin dans quelques secondes.',
      host_unreachable: 'Impossible de joindre {user} — l’appel semble terminé. La fenêtre d’appel va se fermer.',
      call_setup_timeout: 'Impossible de se connecter avec {user}. La fenêtre d’appel va se fermer.',
      invite_not_delivered: 'L’invitation n’a pas pu être envoyée à {user}. Aucun appel ne lui a été adressé.',
      // The reason itself goes to the log: a JS error message is not something
      // to read in a notice.
      call_start_failed: 'Impossible de démarrer l’appel.',
      group_call_unanswered: 'Personne n’a rejoint l’appel. La fenêtre d’appel va se fermer.',
    },
    setup: {
      title: 'Configuration de l’appel',
      notification: {
        no_cameras: 'Aucune caméra vidéo disponible',
        media_access_failed: 'Impossible d’accéder à la caméra ou au microphone',
      },
      tooltip: {
        mute: 'Désactiver le microphone',
        unmute: 'Activer le microphone',
        camera_off: 'Désactiver la caméra',
        camera_on: 'Activer la caméra',
        camera_select: 'Sélectionner la webcam',
      },
    },
    presettings: {
      incoming_call: 'Appel entrant de {address}',
      call_already_over: 'L’appel est déjà terminé',
      btn: {
        start: 'Démarrer l’appel',
        join: 'Rejoindre',
        decline: 'Refuser',
      },
    },
  },

  call: {
    text: {
      participant_invited: 'Appel de {user}…',
      participant_connecting: '{user} se connecte à l’appel…',
      participant_securing: 'Sécurisation de la connexion avec {user}…',
      participant_establishing: 'Établissement de la connexion avec {user}…',
      participant_reconnecting: 'Reconnexion à {user}…',
      host: 'Hôte de l’appel',
      participant_no_response: '{user} ne répond pas',
      participant_not_reached: 'Impossible d’envoyer l’invitation à {user}',
      participant_declined: '{user} a refusé l’appel',
      participant_failed: 'Impossible de se connecter à {user}',
      participant_disconnected: '{user} est déconnecté',
      waiting_for_participants: 'En attente de {count} participant(s) supplémentaire(s)…',
      stream_about_to_start: 'Le flux vidéo de {user} va bientôt démarrer…',
      tap_to_unmute: 'Appuyez pour activer le son',
    },
    tooltip: {
      fullscreen_mode_enable: 'Activer le mode plein écran',
      fullscreen_mode_disable: 'Désactiver le mode plein écran',
      screenshare_mode_row: 'Passer en mode d’affichage horizontal',
      screenshare_mode_column: 'Passer en mode d’affichage vertical',
      mic_on: 'Activer le microphone',
      mic_off: 'Désactiver le microphone',
      camera_on: 'Activer la caméra',
      camera_off: 'Désactiver la caméra',
      sharing_on: 'Ouvrir les paramètres de partage d’écran',
      participants_info: 'Informations sur les participants à l’appel',
    },
    sharing: {
      title: 'Sélectionner le contenu à partager',
      desktop_sound: 'Son du bureau',
      settings: {
        sound_share: 'Partager le son',
        screens_title: 'Écrans',
        windows_title: 'Fenêtres',
      },
    },
  },
};
