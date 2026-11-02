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
    title: 'Treasure',
    menu: {
      makeBackup: 'Créer une sauvegarde',
      uploadBackup: 'Importer une sauvegarde',
      exit: 'Quitter',
    },
    status: {
      label: 'Statut',
      online: 'En ligne',
      offline: 'Hors ligne',
    },
    btn: {
      close: 'Fermer',
      cancel: 'Annuler',
      save: 'Enregistrer',
      apply_crop: 'Appliquer le recadrage',
    },
  },
  list: {
    create: 'Nouvel enregistrement',
    createGroup: 'Nouveau groupe',
    editGroup: 'Modifier le groupe',
    editRecord: 'Modifier l’enregistrement',
    addToFavorites: 'Ajouter aux favoris',
    removeFromFavorites: 'Retirer des favoris',
    copyUsername: 'Copier le nom d’utilisateur',
    copyPassword: 'Copier le mot de passe',
    copyCardNumber: 'Copier le numéro de carte',
    copyCardHolder: 'Copier le titulaire de la carte',
    copyCardExp: 'Copier la date d’expiration',
    copyCardCvv: 'Copier le CVV',
    copyRecord: 'Copier l’enregistrement',
    all: 'Tous les enregistrements',
    recent: 'Récents',
    bank_cards: 'Cartes bancaires',
    cards: 'Cartes personnalisées',
    favorites: 'Favoris',
    search: 'Rechercher des enregistrements',
    noData: 'Aucun enregistrement ici',
    notifications: {
      success: {
        saving: 'L’élément {entity} a été enregistré avec succès.',
        deleting: 'L’élément {entity} a été supprimé avec succès.',
      },
      error: {
        saving: `Oups ! Erreur lors de l’enregistrement de {entity} '{name}'. Veuillez réessayer plus tard.`,
        deleting: `Oups ! Erreur lors de la suppression de {entity} '{name}'. Veuillez réessayer plus tard.`,
      },
      warning: {
        delete: 'Vous ne pouvez pas supprimer ce groupe, car il contient des enregistrements.',
      },
    },
  },
  recordDialog: {
    title: {
      add: 'Ajouter un nouvel enregistrement',
      add_card: 'Ajouter une nouvelle carte',
      add_bank_card: 'Ajouter une nouvelle carte bancaire',
      edit: 'Détails de l’enregistrement',
      edit_card: 'Détails de la carte',
      edit_bank_card: 'Détails de la carte bancaire',
    },
    btn: {
      close: 'Fermer',
      create: 'Créer',
      discard: 'Annuler',
      save: 'Enregistrer les modifications',
      delete: 'Supprimer l’enregistrement',
      switch_to: 'Passer à',
    },
    form: {
      fields: {
        name: {
          label: 'Nom du service',
          placeholder: 'Saisissez le nom de l’enregistrement actuel',
        },
        resource: {
          label: 'Ressource',
          placeholder: 'Saisissez le nom ou le domaine de la ressource de l’enregistrement actuel',
          required: 'Le champ de la ressource ne peut pas être vide.',
          unique:
            'Un enregistrement avec les mêmes valeurs dans les champs ressource et nom d’utilisateur existe déjà.',
        },
        username: {
          label: 'Nom d’utilisateur',
          placeholder: 'Saisissez le nom d’utilisateur pour la ressource sélectionnée',
          required: 'Le champ du nom d’utilisateur ne peut pas être vide.',
          unique:
            'Un enregistrement avec les mêmes valeurs dans les champs nom d’utilisateur et ressource existe déjà.',
        },
        password: {
          label: 'Mot de passe',
          placeholder: 'Saisissez le mot de passe',
          required: 'Le champ du mot de passe ne peut pas être vide.',
        },
        group: {
          label: 'Groupe',
          placeholder: 'Sélectionnez le groupe',
        },
        cardName: {
          label: 'Nom de la carte',
          placeholder: 'Saisissez le nom de la carte actuelle',
          required: 'Le champ du nom de la carte ne peut pas être vide.',
          unique: 'Une carte portant le même nom existe déjà.',
        },
        bancCardName: {
          label: 'Nom de la carte bancaire',
          placeholder: 'Saisissez le nom de la carte bancaire actuelle',
          required: 'Le champ du nom de la carte bancaire ne peut pas être vide.',
        },
        cardNumber: {
          label: 'Numéro de carte',
          placeholder: 'XXXX XXXX XXXX XXXX',
          required: 'Le champ du numéro de carte ne peut pas être vide.',
          length: 'Le numéro de carte doit comporter 16 chiffres.',
        },
        cardHolder: {
          label: 'Titulaire de la carte',
          placeholder: 'NOM COMPLET',
          required: 'Le champ du titulaire de la carte ne peut pas être vide.',
        },
        cardExp: {
          label: 'Date d’expiration',
          placeholder: 'MM/AA',
          required: 'Le champ de la date d’expiration ne peut pas être vide.',
          format: 'La valeur saisie ne respecte pas le format (MM/AA).',
          month: 'Le mois doit être compris entre 01 et 12.',
        },
        cardCvv: {
          label: 'CVV',
          placeholder: '123',
          required: 'Le champ du CVV ne peut pas être vide.',
          length: 'La valeur saisie doit contenir 3 ou 4 chiffres.',
        },
      },
      btns: {
        generate: 'Générer un mot de passe',
      },
      image: {
        upload_btn: 'Importer des images',
        upload_area: 'Cliquez sur cette zone pour importer des images',
        info: 'Maximum 10 fichiers image aux formats pris en charge (png, jpeg, jpg)',
        uploading: 'Importation en cours',
        message: {
          unsupported: 'Ces fichiers ne sont pas pris en charge : {list}',
          limit:
            'Le nombre total d’images dépassera la limite autorisée. Certaines nouvelles images ne seront pas importées.',
        },
        upload_custom_card_images: 'Sélectionner les images de la carte',
        upload_images_btn: 'Importer',
      },
    },
    record_type: {
      password: 'Enregistrement de mot de passe',
      card: 'Carte personnalisée',
      bank_card: 'Carte bancaire',
    },
    text: {
      or: 'ou',
    },
  },
  groupDialog: {
    title: {
      add: 'Ajouter un nouveau groupe',
      edit: 'Détails du groupe',
    },
    btn: {
      close: 'Fermer',
      create: 'Créer',
      save: 'Enregistrer les modifications',
      delete: 'Supprimer le groupe',
    },
    form: {
      fields: {
        name: {
          label: 'Nom du groupe',
          placeholder: 'Saisissez le nom du groupe',
          required: 'Le champ du nom du groupe ne peut pas être vide.',
          unique: 'Un groupe portant le même nom existe déjà.',
        },
        description: {
          label: 'Description du groupe',
          placeholder: 'Saisissez la description du groupe',
        },
      },
    },
  },
  confirmationDeleteGroupDialog: {
    title: 'Supprimer le groupe',
    text: 'Voulez-vous vraiment supprimer ce groupe ?',
    confirmButtonText: 'Supprimer',
    cancelButtonText: 'Annuler',
  },
  confirmationDeleteRecordDialog: {
    title: 'Supprimer l’enregistrement',
    text: 'Voulez-vous vraiment supprimer cet enregistrement ?',
    confirmButtonText: 'Supprimer',
    cancelButtonText: 'Annuler',
  },
  treasuresTable: {
    header: {
      name: 'Nom',
      sync: 'Synchronisation',
      username: 'Nom d’utilisateur / Nom du titulaire / Photo',
      holderName: 'Nom du titulaire',
      photo: 'Photo',
      password: 'Mot de passe / CVV',
      cvv: 'CVV',
    },
    nodata: 'Aucun enregistrement dans le groupe actuel.',
    row: {
      copiedBtn: 'Copié',
      duplicateTooltip: 'Un autre enregistrement possède les mêmes valeurs pour `resource` et `username`.',
    },
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
      placeholder: 'Laissez vide pour ne pas chiffrer',
      openBtn: 'Ouvrir',
      show: 'Afficher la phrase secrète',
      hide: 'Masquer la phrase secrète',
      wrong: 'Cette phrase secrète ne permet pas d’ouvrir cette archive.',
      mismatch: 'Les deux phrases secrètes ne correspondent pas.',
      tooShort: 'La phrase secrète doit comporter au moins {count} caractères.',
      noRecovery: 'Une phrase secrète oubliée ne peut pas être récupérée : l’archive restera illisible.',
      optional:
        'Sans phrase secrète, la confidentialité de l’archive dépend uniquement de l’endroit où vous la conservez.',
    },
    create: {
      dialogTitle: 'Création de la sauvegarde',
      fileDialogTitle: 'Enregistrer la sauvegarde',
      fileDialogBtn: 'Enregistrer',
      text: {
        scanning: 'Analyse du système de fichiers',
        compressing: 'Compression du fichier {number} sur {total}',
        encrypting: 'Chiffrement de l’archive',
        saving: 'Enregistrement du fichier de sauvegarde',
      },
      success: 'La sauvegarde {filename} a été créée et enregistrée.',
      warning: 'Aucune donnée à sauvegarder.',
      cancel: 'Le processus de sauvegarde a été interrompu par l’utilisateur.',
      error: 'Une erreur s’est produite lors de la création du fichier de sauvegarde.',
    },
    restore: {
      dialogTitle: 'Restaurer la sauvegarde',
      fileDialogTitle: 'Sélectionner le fichier de sauvegarde',
      fileDialogBtn: 'Ouvrir',
      confirmTitle: 'Confirmer la restauration des données',
      confirmText:
        'La restauration à partir de la sauvegarde (version {version}) remplacera tous les mots de passe, cartes et groupes actuels. Cette action est irréversible. Voulez-vous continuer ?',
      confirmBtn: 'Restaurer',
      confirmWarningTitle: 'Avertissement de compatibilité',
      confirmWarningText:
        'La version de l’archive de sauvegarde ({archiveVersion}) n’est pas entièrement compatible avec la version de l’application ({appVersion}), ou certaines métadonnées sont manquantes. La restauration de cette archive peut endommager les données de l’application ou provoquer des erreurs. Voulez-vous continuer à vos risques et périls ?',
      confirmAtOwnRiskBtn: 'Restaurer à mes risques et périls',
      text: {
        unpacking: 'Décompression et lecture de l’archive',
        decrypting: 'Déchiffrement de l’archive',
        restoring: 'Restauration du fichier {number} sur {total}',
        syncing: 'Synchronisation des données restaurées',
        syncingWithCount: 'Synchronisation du fichier {number} sur {total}',
        completed: 'Restauration terminée',
      },
      success: 'La sauvegarde a été restaurée avec succès.',
      error: 'Une erreur s’est produite lors de la restauration de la sauvegarde.',
      errorCorruptedArchive:
        'Impossible de lire l’archive de sauvegarde : le fichier est corrompu ou n’est pas un fichier ZIP valide.',
      errorForeignArchive:
        'Cette archive ne contient aucune donnée de Treasure. Il peut s’agir d’une sauvegarde provenant d’une autre application.',
      errorPassphraseRequired: 'Cette archive est chiffrée et nécessite sa phrase secrète.',
      errorEncryptionUnsupported:
        'Cette archive est chiffrée, mais cette application ne peut pas la déchiffrer ici.',
    },
  },
};
