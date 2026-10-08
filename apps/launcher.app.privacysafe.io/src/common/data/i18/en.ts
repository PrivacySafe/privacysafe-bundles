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
    title: 'Dashboard',
    version: 'v {version}',
    status: {
      label: 'status',
      online: 'online',
      offline: 'offline',
    },
    user_menu: {
      logout: 'Logout',
      add: 'Add Account',
      exit: 'Exit',
    },
    tabs: {
      applications: 'My Apps',
      update: 'App Store',
    },
    action: {
      open: 'Open',
      update: 'Update',
      install: 'Install',
      close_old_version: 'Close Old Version',
    },
    update: {
      search_placeholder: 'Search for app',
    },
    list: {
      empty: 'No applications found',
    },
    add: {
      tooltip: 'Add app from file',
    },
    mobile: {
      menu: {
        my_apps: 'My Apps',
        updates: 'Updates',
        store: 'App Store',
        settings: 'Settings',
      },
    },
    orientation: {
      rotateBack: 'Please rotate your phone back to portrait orientation',
    },
    info: {
      details: 'App details',
      publisher: 'Publisher',
      website: 'Website',
      contact: 'Contact',
      policy: 'Privacy policy',
      terms: 'Terms of service',
      license: 'License',
      source: 'Source code',
    },
  },

  btn: {
    'check-update': 'Check for Updates',
    'checking-for-update': 'Checking for Updates',
    'restart-platform': 'Restart to Update',
  },

  version: {
    'to-update': 'Current version: {current}. New version: {update}',
    'to-install': 'New version: {install}',
  },

  settings: {
    title: 'settings',
    btn: {
      open: 'Open settings',
      'custom-logo': {
        'add-logo': 'Add Custom Logo',
      },
    },
    section: {
      appearance: 'Appearance',
    },
    system: 'System',
    label: {
      autoupdates: 'Automatic Updates',
      on: 'On',
      off: 'Off',
      yes: 'Yes',
      no: 'No',
      theme: 'Theme',
      language: 'Language',
      'custom-logo': 'Custom Logo',
      showing_devtool: 'Show devtool',
      autologin: 'Automatic Login',
      autologin_enter_password: 'Enter your password to enable Automatic Login',
    },
    placeholder: {
      password: 'Password',
    },
    messages: {
      autologin_set_success: 'Automatic Login is Enabled',
      autologin_password_wrong: `Incorrect Password can't enable Automatic Login`,
      save_success: 'The apps settings save successful',
      save_error: 'The apps settings save error',
    },
    theme: {
      light: 'Light',
      midnight: 'Midnight Blue',
      dark: 'Dark',
    },
  },

  dialog: {
    'select-logo-file': {
      title: 'Select file with Custom Logo',
      btn: 'Select',
    },
    'open-file': {
      'image-type': 'Images',
    },
    settings_dialog_autologin: {
      title: 'Enable Automatic Login',
    },
  },

  install: {
    process: 'The initial installation of applications is in progress',
  },

  update_check: {
    start: 'Checking for Updates',
    in_progress: 'Checking for updates in progress',
    updates_found: '{numOfUpdates} of Update(s) Found',
    no_updates: 'No Updates Found',
    messages: {
      error: {
        updates: 'Error determining need to update applications. Please try again later.',
      },
    },
  },

  platform: {
    title: 'PrivacySafe',
    description: 'Core platform required for your apps to work.',
    action_restart: 'Restart to Update',
  },

  system: {
    init_setup_start: 'Setting up your system on the first startup with bundled apps {appsList}',
    init_setup_done: 'System setup is done',
    data_removal: {
      section: 'Data removal',
      wipe_from_device: 'Wipe data from this device',
    },
    map: {
      tooltip: 'System map',
      control: {
        zoom: 'Zoom',
        formFactor: {
          label: 'Form Factor',
          desktop: 'desktop',
          phone: 'phone',
        },
        direction: 'Direction',
        sketch: 'Sketch',
      },
    },
  },
};
