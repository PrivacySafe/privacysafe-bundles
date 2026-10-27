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
  '-': '',

  app: {
    title: 'Stockage',
    status: {
      label: 'Statut',
      online: 'En ligne',
      offline: 'Hors ligne',
    },
    open: 'Ouvrir',
    exit: 'Quitter',
    create: 'Créer',
    create_folder: 'Créer un dossier',
    selected: 'Sélectionné',
    favorites_title: 'Favoris',
    settings: {
      title: 'Paramètres',
      label: {
        folders_local: 'Afficher les dossiers locaux',
        folders_system: 'Afficher les dossiers système',
        folders_device: 'Afficher les dossiers de l’appareil',
        on: 'Activé',
        off: 'Désactivé',
      },
    },
    sync: {
      start: 'La synchronisation des dossiers et des fichiers est en cours',
    },
    upload: 'Téléverser',
    upload_file: 'Téléverser un fichier',
    adopt: 'Adopter',
    download: 'Télécharger',
    resolve: 'Résoudre',
    damaged: 'Endommagé',
    damaged_reason: 'Erreurs lors de',
  },

  dashboard: {
    toolbar: {
      action: {
        shift_path_left: 'Déplacer le chemin vers la gauche',
        shift_path_right: 'Déplacer le chemin vers la droite',
      },
      tooltip: {
        table_view: 'Vue en tableau',
        tile_view: 'Vue en mosaïque',
        split_mode: 'Mode fractionné',
        simple_mode: 'Mode simple',
      },
    },
  },

  validation: {
    text: {
      required: 'Ce champ est obligatoire. ',
      equality: 'Les anciennes et nouvelles valeurs ne doivent pas être identiques. ',
      length: 'Pas plus de {length} caractères ',
    },
  },

  dialog: {
    upload_files: {
      text1: 'Vos fichiers seront téléversés dans le dossier suivant',
      text2: `Vous pouvez <b>glisser-déposer</b> des fichiers ici ou`,
    },
    warning: {
      title: 'Avertissement',
    },
    button: {
      confirm: 'Terminé',
      cancel: 'Annuler',
    },
    confirmation: {
      text: 'Êtes-vous sûr ?',
    },
    create_folder: {
      title: 'Créer un dossier',
      button: {
        confirm: 'Créer',
      },
    },
    rename_folder: {
      title: 'Renommer le dossier',
      field: {
        placeholder: {
          input: 'Saisir le nom',
        },
      },
    },
    rename_file: {
      title: 'Renommer le fichier',
    },
    resolve: {
      title: 'Outil de résolution des conflits',
      btn: {
        compare: 'Comparer',
        back: 'Retour',
        keep_cloud: 'Conserver la version cloud',
        keep_local: 'Conserver la version locale',
        keep_both: 'Conserver les deux versions',
        merge: 'Fusionner',
        absorb: 'Intégrer les modifications distantes',
        absorb_tooltip: 'Cliquez sur ce bouton pour intégrer les modifications distantes dans le dossier local.',
      },
      cloud_text: 'Cloud',
      local_text: 'Local',
      checkbox_text: 'Appliquer cette option à tous les éléments en conflit',
    },
    restore: {
      text: 'Un élément nommé "{name}" existe déjà dans ce dossier | Des éléments nommés "{name}" existent déjà dans ce dossier',
      question: 'Voulez-vous le remplacer ? | Voulez-vous les remplacer ?',
    },
    file_exist: {
      title: 'Le fichier existe déjà',
      placeholder: {
        new_name: 'Nouveau nom de fichier',
      },
      warning: 'existe déjà dans ce dossier. Voulez-vous l’écraser ou choisir un autre nom ?',
      button: {
        rename: 'Renommer',
        cancel: '@:dialog.button.cancel',
        change: 'Modifier',
        overwrite: 'Écraser',
      },
    },
  },

  folder_banner: {
    text: {
      resolve_root: 'Veuillez résoudre le conflit dans le répertoire d’accueil',
      resolve_trash: 'Veuillez résoudre le conflit dans le répertoire de la corbeille',
    },
  },

  favorite_folder: {
    warning: {
      missing_text:
        'Le dossier favori "{path}" que vous souhaitez ouvrir est introuvable (il a peut-être été supprimé ou déplacé)',
      missing_question: 'Voulez-vous supprimer le dossier sélectionné de la liste des favoris ?',
    },
  },

  fs: {
    folder_name: {
      user_synced_home: 'Accueil',
      user_local_home: 'Accueil (local)',
      user_synced_recent: 'Récents',
      user_synced_trash: 'Corbeille',
      user_local_trash: 'Corbeille (locale)',
    },
    table: {
      header: {
        name: 'Nom',
        type: 'Type',
        size: 'Taille',
        sync: 'Synchronisation',
        date: 'Date',
      },
      folder: {
        empty_shorttext: 'Le dossier est vide',
        empty_text: 'Le dossier est vide. Vous pouvez glisser-déposer des fichiers ici ou',
      },
    },
    tile: {
      header: {
        text_default: 'Cliquer pour activer',
        text_active: 'Panneau actif',
      },
    },
    entity: {
      sorting_text: 'Tri',
      info: {
        type: 'Type',
        type_folder: 'Dossier',
        type_file: 'Fichier',
        type_link: 'Lien',
        path: 'Chemin',
        size: 'Taille',
        date: 'Date de création',
        changes: 'Dernière modification',
        tags: 'Étiquettes',
        status: 'État de synchronisation',
        calculate_hash: 'Calculer le hachage',
      },
      button: {
        restore_replace: 'Remplacer',
        restore_keep: 'Conserver les deux',
      },
      message: {
        success: {
          delete:
            'L’élément sélectionné a été supprimé avec succès. | Les éléments sélectionnés ({count}) ont été supprimés avec succès.',
          restore: 'Les éléments sélectionnés ont été restaurés avec succès.',
          download:
            'L’élément sélectionné a été téléchargé avec succès. | Les éléments sélectionnés ({count}) ont été téléchargés avec succès.',
          copy: 'L’élément sélectionné a été copié avec succès. | Les éléments sélectionnés ({count}) ont été copiés avec succès.',
          move: 'L’élément sélectionné a été déplacé avec succès. | Les éléments sélectionnés ({count}) ont été déplacés avec succès.',
        },
        error: {
          delete:
            'Erreur lors de la suppression de l’élément sélectionné. | Erreur lors de la suppression des éléments sélectionnés ({count}).',
          restore: 'Erreur lors de la restauration des éléments sélectionnés.',
          download:
            'Erreur lors du téléchargement de l’élément sélectionné. | Erreur lors du téléchargement des éléments sélectionnés ({count}).',
          copy: 'Erreur lors de la copie de l’élément sélectionné. | Erreur lors de la copie des éléments sélectionnés ({count}).',
          move: 'Erreur lors du déplacement de l’élément sélectionné. | Erreur lors du déplacement des éléments sélectionnés ({count}).',
          open: 'Impossible d’ouvrir « {name} »',
        },
      },
    },
    action: {
      copy_label: 'Copier',
      move_label: 'Déplacer',
      copying: 'Copie en cours',
      moving: 'Déplacement en cours',
    },
    bulk_action: {
      tooltip: {
        set_favorite: 'Ajouter aux favoris / Retirer des favoris',
        download: 'Télécharger les éléments sélectionnés',
        resolve: 'Résoudre les conflits des éléments sélectionnés',
        delete: 'Déplacer les éléments sélectionnés vers la corbeille',
        delete_completely: 'Supprimer définitivement les éléments sélectionnés',
        restore: 'Restaurer les éléments sélectionnés',
        copy_move: 'Copier / Déplacer les éléments sélectionnés',
      },
    },
    permanently_delete: {
      title: 'Confirmer la suppression définitive',
      warning1: 'Voulez-vous vraiment supprimer définitivement les éléments sélectionnés ?',
      warning2: 'Cette action est irréversible.',
      button: {
        confirm: 'Supprimer définitivement',
      },
    },
    mount: {
      button: {
        busy: 'Veuillez patienter…',
        mount: 'Monter',
        unmount: 'Démonter',
      },
      message: {
        success: {
          mount: 'Le dossier est monté',
          unmount: 'Le dossier est démonté',
        },
        error: {
          mount: 'Impossible de monter le dossier',
          unmount: 'Impossible de démonter le dossier',
          unmount_unconfirmed:
            'Impossible de confirmer que le dossier a été démonté. Veuillez vérifier votre gestionnaire de fichiers.',
        },
      },
    },
  },
  file_picker: {
    header: {
      select_file: 'Sélectionner des fichiers',
      save_file: 'Enregistrer les fichiers',
      select_folder: 'Sélectionner un dossier',
      save_folder: 'Enregistrer le dossier',
    },
    message_status: {
      loading: 'Chargement...',
      load_error: 'Impossible de charger ce dossier.',
    },
    button: {
      cancel: '@:dialog.button.cancel',
      select: 'Sélectionner',
      save: 'Enregistrer',
      go: 'Aller',
      proceed: 'Continuer',
      next: 'Suivant',
      enter: 'Entrer',
      new_folder: 'Nouveau dossier',
      create: 'Créer',
      use_folder: 'Utiliser le dossier',
      select_this_folder: 'Sélectionner ce dossier',
    },
    selected_items: 'Éléments sélectionnés',
    sidebar_title: 'Parcourir',
    tab_3n_storage: 'Stockage 3N',
    notification: {
      error: {
        invalid_filename:
          'Nom de fichier invalide. Évitez les caractères réservés, les caractères de contrôle et les noms système réservés.',
        save_file: 'Échec de l’enregistrement du fichier',
        open_file: 'Échec de l’ouverture du fichier sélectionné',
        folder_name_collision: 'Un dossier portant ce nom existe déjà. Veuillez choisir un autre nom.',
        open_folder: 'Échec de l’ouverture du dossier.',
        save_folder: 'Échec de la préparation du dossier pour l’enregistrement.',
        create_folder:
          'Échec de la création du dossier. Vérifiez son nom et vos droits d’accès à cet emplacement.',
        folder_create_conflict: 'Un élément portant ce nom existe déjà. Choisissez un autre nom.',
        folder_target_conflict:
          'Un fichier ou un lien portant ce nom existe déjà. Choisissez un autre nom de dossier.',
        folder_unavailable: 'Ce dossier n’est plus disponible. Choisissez un autre dossier.',
      },
      success: {
        save_file: 'Fichier enregistré avec succès',
      },
    },
    footer: {
      save_as: 'Enregistrer sous',
    },
    category: {
      home: 'Accueil',
      device: 'Appareil',
      system_synced: 'Système synchronisé',
      system_local: 'Système local',
      device_system: 'Système de l’appareil',
    },
    folder_name: 'Nom du dossier',
    folder_name_empty_hint: 'Laissez ce champ vide pour utiliser le dossier actuel.',
    folder_exists: {
      title: 'Utiliser un dossier existant',
      message:
        'Un dossier nommé « {name} » existe déjà. Voulez-vous utiliser ce dossier ? Son contenu existant sera conservé.',
    },
  },
};
