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
    title: 'Tableau de bord',
    version: 'v {version}',
    status: {
      label: 'statut',
      online: 'en ligne',
      offline: 'hors ligne',
    },
    user_menu: {
      logout: 'Déconnexion',
      add: 'Ajouter un compte',
      exit: 'Sortie',
    },
    tabs: {
      applications: 'Mes applications',
      update: 'Boutique d’applications',
    },
    action: {
      open: 'Ouvrir',
      update: 'Mise à jour',
      install: 'Installer',
      close_old_version: "Fermer l'ancienne version",
    },
    update: {
      search_placeholder: 'Rechercher une application',
    },
    list: {
      empty: 'Aucune candidature trouvée',
    },
    add: {
      tooltip: 'Ajouter une application à partir d’un fichier',
    },
    mobile: {
      menu: {
        my_apps: 'Mes applications',
        updates: 'Mises à jour',
        store: "Magasin d'applications",
        settings: 'Paramètres',
      },
    },
    orientation: {
      rotateBack: 'Veuillez remettre votre téléphone en orientation portrait.',
    },
    info: {
      details: 'Détails de l’application',
      publisher: 'Éditeur',
      website: 'Site web',
      contact: 'Contact',
      policy: 'Politique de confidentialité',
      terms: 'Conditions d’utilisation',
      license: 'License',
      source: 'Code source',
    },
  },

  btn: {
    'check-update': 'Rechercher des mises à jour',
    'checking-for-update': 'Recherche de mises à jour',
    'restart-platform': 'Redémarrer pour mettre à jour',
  },

  version: {
    'to-update': 'Version actuelle : {current}. Nouvelle version : {update}',
    'to-install': 'Nouvelle version : {install}',
  },

  settings: {
    title: 'paramètres',
    btn: {
      open: 'Ouvrir les paramètres',
      'custom-logo': {
        'add-logo': 'Ajouter un logo personnalisé',
      },
    },
    section: {
      appearance: 'Apparence',
    },
    system: 'Système',
    label: {
      autoupdates: 'Mises à jour automatiques',
      on: 'Sur',
      off: 'Désactivé',
      yes: 'Oui',
      no: 'Non',
      theme: 'Thème',
      language: 'Langue',
      'custom-logo': 'Logo personnalisé',
      showing_devtool: 'Afficher les outils de développement',
      autologin: 'Connexion automatique',
      autologin_enter_password: 'Saisissez votre mot de passe pour activer la connexion automatique',
    },
    placeholder: {
      password: 'Mot de passe',
    },
    messages: {
      autologin_set_success: 'La connexion automatique est activée',
      autologin_password_wrong: `Mot de passe incorrect ; impossible d’activer la connexion automatique.`,
      save_success: "Les paramètres de l'application ont été enregistrés avec succès.",
      save_error: "Erreur lors de l'enregistrement des paramètres de l'application",
    },
    theme: {
      light: 'Lumière',
      midnight: 'Bleu minuit',
      dark: 'Sombre',
    },
  },

  dialog: {
    'select-logo-file': {
      title: 'Sélectionner un fichier avec un logo personnalisé',
      btn: 'Sélectionner',
    },
    'open-file': {
      'image-type': 'Images',
    },
    settings_dialog_autologin: {
      title: 'Activer la connexion automatique',
    },
  },

  install: {
    process: "L'installation initiale des applications est en cours.",
  },

  update_check: {
    start: 'Recherche de mises à jour',
    in_progress: 'Recherche de mises à jour en cours',
    updates_found: '{numOfUpdates} mise(s) à jour trouvée(s)',
    no_updates: 'Aucune mise à jour trouvée',
    messages: {
      error: {
        updates:
          'Erreur lors de la détermination de la nécessité de mettre à jour les applications. Veuillez réessayer plus tard.',
      },
    },
  },

  platform: {
    title: 'PrivacySafe',
    description: 'Plateforme centrale nécessaire au fonctionnement de vos applications.',
    action_restart: 'Redémarrer pour mettre à jour',
  },

  system: {
    init_setup_start:
      'Configuration de votre système lors du premier démarrage avec les applications incluses {appsList}',
    init_setup_done: 'La configuration du système est terminée.',
    data_removal: {
      section: 'Suppression de données',
      wipe_from_device: 'Effacer les données de cet appareil',
    },
    map: {
      tooltip: 'Plan du réseau',
      control: {
        zoom: 'Zoom',
        formFactor: {
          label: 'Format',
          desktop: 'ordinateur de bureau',
          phone: 'téléphone',
        },
        direction: 'Direction',
        sketch: 'Esquisser',
      },
    },
  },
};
