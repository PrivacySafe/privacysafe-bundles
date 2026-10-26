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
    title: 'Contacts',
    sync: {
      status: 'État de la synchronisation',
    },
    status: {
      label: 'Statut',
      connected: {
        online: 'en ligne',
        offline: 'hors ligne',
      },
      synced: 'synchronisé',
      unsynced: 'non synchronisé',
    },
    exit: 'Fermer',
    menu: {
      tutorial: 'Revoir le tutoriel',
      makeBackup: 'Créer une sauvegarde',
      uploadBackup: 'Restaurer à partir d’une sauvegarde',
      exit: 'Fermer',
    },
    btn: {
      cancel: 'Annuler',
      save: 'Enregistrer',
      add: 'Ajouter',
      share: 'Partager',
    },
    info: {
      status: {
        online:
          'Vous êtes actuellement en ligne. Toutes les modifications effectuées précédemment seront synchronisées.',
        offline:
          'Vous êtes actuellement hors ligne. Toutes les modifications resteront sur cet appareil jusqu’à ce qu’il soit connecté.',
      },
    },
    warning: {
      label: 'Avertissement',
      'sync-stuck':
        'La synchronisation n’a pas repris, bien que cet appareil soit en ligne. Les modifications sont conservées sur cet appareil. Redémarrez l’application pour les synchroniser.',
      'changes-not-published':
        'Les modifications effectuées sur cet appareil sont enregistrées localement, mais le serveur continue de les refuser. Elles ne sont pas perdues et seront publiées dès que le serveur les acceptera à nouveau. Redémarrer l’application permet parfois de résoudre le problème.',
      'first-run-needs-network':
        'Cette application doit être lancée une fois alors que vous êtes en ligne : son espace de stockage ne peut pas être créé sur cet appareil sans le serveur. Connectez-vous et relancez l’application.',
      'service-unavailable': 'Le service de contacts n’a pas démarré. Redémarrez l’application.',
    },
  },
  action: {
    select: {
      all: 'Tout sélectionner',
    },
    deselect: {
      all: 'Tout désélectionner',
    },
    open: {
      chat: {
        tooltip: 'Ouvrir une discussion avec le contact',
      },
      mail: {
        tooltip: 'Créer un message pour le contact',
      },
    },
    show: {
      keys: {
        own: 'Afficher les informations sur vos propres clés',
        contact: 'Afficher les informations sur les clés du contact',
      },
    },
  },
  confirmation: {
    warning: 'Avertissement',
    delete: {
      one: 'Vous êtes sur le point de supprimer le contact {name}. Cette opération supprimera toutes les activités de cet utilisateur.',
      multiple:
        'Vous êtes sur le point de supprimer {count} contacts. Cette opération supprimera toutes les activités de ces utilisateurs.',
    },
  },
  contacts: {
    search: {
      placeholder: 'Rechercher dans les noms et les adresses e-mail des contacts',
    },
    selected: 'Sélectionnés : {number}',
  },
  contact: {
    action: {
      delete: 'Supprimer le contact',
      block: 'Ajouter à la liste de blocage',
      unblock: 'Retirer de la liste de blocage',
    },
    block: {
      dialogText: 'Vous êtes sur le point d’ajouter {contact} à la liste de blocage.',
      error: 'Erreur lors du blocage du contact avec l’identifiant "{id}"',
      confirmBtn: 'Bloquer',
      mark: 'Bloqué',
    },
    unblock: {
      dialogText: 'Vous êtes sur le point de retirer {contact} de la liste de blocage.',
      error: 'Erreur lors du déblocage du contact avec l’identifiant "{id}"',
      confirmBtn: 'Débloquer',
    },
    delete: {
      title: 'Supprimer le contact | Supprimer les contacts',
      confirmBtn: 'Supprimer',
      cancelBtn: 'Annuler',
      success: 'Le contact a été supprimé. | Les contacts ont été supprimés.',
      error:
        'Erreur lors de la suppression du contact. Contactez le support. | Erreur lors de la suppression des contacts. Contactez le support.',
    },
    upsert: {
      success: 'Le contact a été enregistré.',
      error: 'Erreur lors de l’enregistrement du contact. Contactez le support.',
    },
    placeholder: 'Sélectionnez un utilisateur pour voir ses détails',
    avatar: {
      upload: 'Téléverser une image',
      delete: 'Supprimer l’image',
    },
    content: {
      identity: 'Identité',
      name: 'Nom',
      phone: 'Téléphone',
      note: 'Note',
    },
    myself: {
      name: 'Moi',
    },
    dialog: {
      title: {
        'own-keys': 'Clés personnelles',
        'contact-keys': '{contact} Clés',
      },
    },
  },
  validation: {
    text: {
      required: 'Ce champ est obligatoire.',
      mail: 'Adresse e-mail invalide.',
      usage: 'Cette adresse e-mail est déjà utilisée.',
    },
  },
  'keys-info': {
    'key-on-server': {
      'no-key':
        'Aucune clé publique initiale n’est présente sur le serveur. En l’absence d’une telle clé, de nouvelles personnes ne peuvent pas vous envoyer de messages, tandis que vos contacts existants — avec lesquels des chaînes de clés de communication ont déjà été établies — peuvent continuer à vous en envoyer.',
      section: 'Clé publique initiale sur le serveur ASMail',
      btn: {
        'make-new': 'Créer une nouvelle clé',
        update: 'Mettre à jour la clé',
        remove: 'Retirer la clé',
      },
    },
    'sending-key-pair': 'Paire de clés pour l’envoi',
    'receiving-key-pair-in-use': 'Paire de clés utilisée pour la réception',
    'receiving-key-pair-suggested': 'Paire clé suggérée ensuite pour la réception',
    'receiving-key-pair-old': 'Paire de clés précédente pour la réception',
    'no-contact-keys': 'Aucune clé présente pour ce contact.',
    'key-id': 'Identifiant de clé',
    'your-key-id': 'Votre identifiant de clé',
    'contact-key-id': `Identifiant clé du contact`,
    'contact-intro-key-id': `Identifiant de la clé initiale du contact`,
    expiry: 'Expiration',
    alg: 'Algorithme',
    'mid-certifier': 'certificateur MailerId',
    timestamp: 'Horodatage',
    'last-msg-ts': 'Dernière utilisation le',
    'num-of-sent-msgs': 'Nombre de messages envoyés',
    'received-msgs': 'Messages reçus',
    'random-pids': 'Identifiants de paires aléatoires',
  },
  reachability: {
    'not-present-at-domain':
      'Il n’existe aucun compte de ce type sur ce domaine ; {mail} ne peut donc pas recevoir de messages. Vérifiez l’adresse.',
    'no-service-for-domain':
      'Ce domaine ne propose aucun service de messagerie 3NWeb ; {mail} ne peut donc pas recevoir de messages.',
    'access-restricted':
      '{mail} existe, mais l’accès en écriture y est restreint ; il est donc possible que votre message ne soit pas accepté.',
    offline: 'Disponible lorsque connecté.',
    'contact-not-saved': 'Disponible une fois le contact enregistré.',
  },
  backup: {
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
    create: {
      dialogTitle: 'Création de la sauvegarde',
      fileDialogTitle: 'Enregistrer la sauvegarde',
      fileDialogBtn: 'Enregistrer',
      text: {
        scanning: 'Lecture du carnet d’adresses',
        compressing: 'Compression de {number} sur {total}',
        encrypting: 'Chiffrement de l’archive',
        saving: 'Enregistrement du fichier de sauvegarde',
      },
      success: 'La sauvegarde {filename} a été enregistrée.',
      empty: 'Il n’y a rien à sauvegarder.',
      cancel: 'La création de la sauvegarde a été interrompue.',
      error: 'La sauvegarde n’a pas pu être créée.',
    },
    restore: {
      dialogTitle: 'Restauration de la sauvegarde',
      fileDialogTitle: 'Sélectionner un fichier de sauvegarde',
      fileDialogBtn: 'Ouvrir',
      confirmTitle: 'Confirmer la restauration',
      confirmText:
        'La restauration remplacera vos {current} contacts par les {archived} contacts de cette sauvegarde. Les contacts absents de la sauvegarde seront supprimés. Cette opération est irréversible.',
      confirmBtn: 'Restaurer',
      confirmWarningTitle: 'Avertissement de compatibilité',
      confirmWarningText:
        'Cette archive a été créée avec la version {archiveVersion}, tandis que cette application utilise la version {appVersion}, ou bien l’archive ne contient aucune information de version. Sa restauration pourrait endommager le carnet d’adresses. Voulez-vous continuer à vos risques et périls ?',
      confirmAtOwnRiskBtn: 'Restaurer quand même',
      unknownVersion: 'inconnue',
      text: {
        unpacking: 'Lecture de l’archive',
        decrypting: 'Déchiffrement de l’archive',
        restoringImages: 'Restauration de l’image {number} sur {total}',
        restoringContacts: 'Restauration de {total} contacts',
        syncing: 'Synchronisation des données restaurées',
        syncDeferred: 'Restauration effectuée sur cet appareil ; la synchronisation aura lieu ultérieurement',
        completed: 'Restauration terminée',
      },
      success: 'La sauvegarde a été restaurée.',
      error: 'La sauvegarde n’a pas pu être restaurée.',
      errorCorruptedArchive: 'Ce fichier est endommagé ou n’est pas une archive ZIP.',
      errorForeignArchive:
        'Cette archive est une sauvegarde d’une autre application, et non de l’application Contacts.',
      errorNoContacts:
        'Cette archive ne contient aucun contact. Il peut s’agir d’une sauvegarde d’une autre application.',
      errorUnreadableDb: 'Les contacts contenus dans cette archive ne peuvent pas être lus.',
      errorPassphraseRequired: 'Cette archive est chiffrée et nécessite sa phrase secrète.',
      errorEncryptionUnsupported:
        'Cette archive est chiffrée, mais cette application ne peut pas la déchiffrer ici.',
    },
  },
  qrcode: {
    'save-dialog-title': 'Enregistrer le code QR',
    'save-dialog-button': 'Sauve-moi',
    'save-qr-tooltip': 'Enregistrer / Télécharger le code QR',
    'copy-link-tooltip': 'Copier le lien',
    'copy-link-text': 'Lien copié',
    'save-success': 'Code QR enregistré avec succès',
    'save-invalid': 'Format d’image non valide',
    'color-qr-tooltip': 'Changer de couleur',
    'color-close-panel': 'Fermer',
    'copy-link-error': 'Erreur lors de la copie du lien',
    'download-qr-error': "Erreur lors de l'enregistrement de l'image du code QR",
  },
  share: {
    title: 'Partager',
    label: 'Destinataire',
    placeholder: 'Sélectionner un destinataire',
    btnLabel: {
      chat: 'Discussion',
      mail: 'E-mail',
    },
    noChatHint:
      'Le partage via la discussion est disponible uniquement lorsqu’une conversation active existe avec le destinataire.',
    progress: {
      title: 'Partage des contacts',
      preparing: 'Préparation du fichier : {number} contacts sur {total}',
      sending: {
        chat: 'Transfert du fichier vers la discussion…',
        mail: 'Transfert du fichier vers la messagerie…',
      },
      error: 'Impossible de partager les contacts',
      cancelled: 'Le partage des contacts a été annulé',
    },
  },

  import: {
    title: 'Importation de contacts',
    progress: '{number} contacts importés sur {total}',
    notFound: 'Cette importation de contacts est déjà terminée ou a expiré. Ouvrez à nouveau le fichier.',
    result: 'Importation des contacts terminée : {added} ajoutés, {updated} mis à jour, {skipped} ignorés',
    field: {
      avatar: 'Photo de profil',
    },
    conflict: {
      title: 'Vous possédez déjà le contact {mail}',
      current: 'Actuel',
      incoming: 'Reçu',
      empty: 'vide',
      applyToAll: 'Appliquer à tous les conflits restants',
    },
    btn: {
      abort: 'Arrêter',
      keep: 'Conserver l’actuel',
      incoming: 'Utiliser les données reçues',
      byFields: 'Choisir les champs',
      apply: 'Appliquer',
    },
  },

  tutorial: {
    create: 'Appuyez pour créer un nouveau contact.',
    mobileMenuBtn: 'Appuyez pour ouvrir le menu de l’application.',
    meListItem:
      'Voici comment un contact apparaît dans la liste des contacts. Appuyez dessus pour ouvrir le formulaire de modification du contact.',
    'make-backup': 'En appuyant, vous lancerez le processus de création d’un fichier de sauvegarde.',
    'upload-backup':
      'Appuyer sur cet élément lancera le processus de restauration des données d’application à partir du fichier de sauvegarde que vous avez sélectionné.',
    'repeat-tutorial': 'Appuyer ici permet de relancer le tutoriel.',
  },
};
