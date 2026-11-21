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
  signin: {
    title: 'Connexion',
    btn: {
      login: 'Se connecter',
      entering: 'Connexion en cours... {percent}%',
      make_account: 'Créer un compte',
      scan_qr: 'Scanner le QR code',
      or: 'OU',
    },
    footer: {
      like_it: 'Vous aimez ce que nous faisons ?',
      support_us: 'Soutenez-nous',
    },
  },

  placeholder: {
    username: `Nom d'utilisateur`,
    enter_password: 'Mot de passe',
    create_password: 'Mot de passe',
    confirm_password: 'Confirmer le mot de passe',
  },

  autologin: {
    on: 'Connexion automatique activée',
    off: 'Connexion automatique désactivée',
  },

  signup: {
    title: 'Créer un nom d’utilisateur',
    choice: {
      status: {
        have_domains_without_token: 'Domaines d’inscription disponibles sans jeton',
        have_domains_with_token: 'Domaines disponibles avec un jeton',
        no_domains_without_token: 'Aucun domaine disponible. Un jeton est peut-être nécessaire.',
        no_domains_with_token: 'Aucun domaine disponible. Le jeton est-il correct ?',
      },
      err: {
        no_connect: 'Échec de la connexion. L’URL est-elle correcte ?',
        non_ok_status: 'Réponse inattendue du serveur ({status}). L’URL est-elle correcte ?',
        general: 'Une erreur s’est produite. L’URL est-elle correcte ? L’appareil est-il connecté à Internet ?',
      },
    },
    step: {
      count: 'Étape {num} sur {total} : {text}',
      text1: 'Sélectionner un fournisseur',
      text2: 'Créer un nom d’utilisateur',
      text3: 'Créer un mot de passe',
      text4: 'Informations importantes',

      btn: {
        next: 'Suivant',
      },
      create_user: {
        username_length_txt: 'Le nom d’utilisateur doit contenir entre 6 et 60 caractères.',
        username_chars_txt:
          'Utilisez des lettres latines, des chiffres et certains caractères : - (trait d’union), . (point) ou _ (tiret bas).',
        txt: 'Le nom d’utilisateur doit contenir entre 6 et 60 caractères. Vous pouvez utiliser des lettres, des chiffres et certains caractères : - (trait d’union), . (point) ou _ (tiret bas). Vous pouvez également utiliser des caractères de n’importe quelle langue.',
        domain_label: 'S’inscrire sur le domaine',
        status: {
          addr_not_available: 'L’adresse {address} n’est pas disponible.',
        },
      },
      create_password: {
        pass_length_txt: 'Le mot de passe doit contenir au moins 12 caractères.',
        pass_chars_txt: 'Utilisez uniquement des lettres latines, des chiffres et certains caractères : ',
        confirmation_txt: 'Les mots de passe doivent être identiques.',
      },
      acknowledgments: {
        title: 'Confirmation importante',
        txt: {
          intro: 'Veuillez confirmer les points suivants :',
          check1: {
            p1: 'Je confirme être âgé(e) de 18 ans ou plus.',
          },
          check2: {
            p1: 'Je comprends qu’un mot de passe perdu ne peut pas être récupéré.',
          },
          check3: {
            p1: 'Je conserverai une copie de sauvegarde sécurisée de mon mot de passe, par exemple une copie papier rangée dans un endroit fermé à clé.',
          },
        },
        btn: 'Créer un compte',
      },
      progress: {
        txt: 'Préparation de votre espace sécurisé...',
        key_generation_txt: 'Préparation de votre clé...',
      },
    },
    provider: {
      stepTitle: 'Choisissez votre identité',
      silver: {
        title: 'Argent',
        info: '{type} {domain}',
        type: 'GRATUIT',
      },
      gold: {
        title: 'Or',
        info: '{type} {domain}',
        type: 'PRO',
      },
      platinum: {
        title: 'Platine',
        info: '{type} {domain}',
        type: 'VIP',
      },
      custom_link: {
        input_placeholder: 'Jeton ou lien du compte',
        account_help: 'Aide concernant le compte',
      },
      existing_signup_link: 'Déjà inscrit ?',
      footer_info_link_txt: 'Hébergez votre propre domaine',
    },
  },

  'boot-screen': {
    txt: 'Préparation de votre espace sécurisé...',
    logs: {
      summary: 'Messages de démarrage du système :',
      btn_show: 'Afficher les messages de démarrage du système',
      btn_hide: 'Masquer les messages de démarrage du système',
    },
  },

  err: {
    domain_not_found: 'Le domaine {domain} est introuvable. Est-il correctement saisi ?',
    domain_has_no_srv: 'Le domaine {domain} ne dispose d’aucun service. Est-il correctement saisi ?',
    incorrect_password: 'Mot de passe incorrect. Veuillez réessayer.',
    login_not_recognized: 'L’identifiant {login} n’est pas reconnu. Est-il correctement saisi ?',
    incorrect_login: 'Identifiant incorrect.',
    field_required: 'Ce champ ne peut pas être vide. ',
    login_length:
      'L’identifiant doit contenir entre 6 et 60 caractères, parmi les lettres, les chiffres et les caractères autorisés. ',
    login_characters: 'L’identifiant contient des caractères interdits. ',
    password_length: 'Le mot de passe doit contenir au moins 12 caractères. ',
    password_characters: 'Le mot de passe contient des caractères interdits. ',
    confirmation_err: 'Les mots de passe ne correspondent pas.',
    singup_available_err: `Le compte n’a pas été créé. L’adresse {address} n’est plus disponible. Veuillez essayer une autre adresse.`,
    singup_general_err: `Oups... Nous sommes vraiment désolés, une erreur s’est produite. Veuillez fermer l’application et réessayer de vous inscrire plus tard.`,
    sign_in: 'Erreur de connexion. Veuillez réessayer plus tard.',
    invalid_login: `L’identifiant doit contenir le symbole {'@'}. `,
  },
};
