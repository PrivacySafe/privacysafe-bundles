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
  '-': '',

  app: {
    title: 'Storage',
    status: {
      label: 'Status',
      online: 'online',
      offline: 'offline',
    },
    open: 'Open',
    exit: 'Exit',
    create: 'Create',
    create_folder: 'Create Folder',
    selected: 'Selected',
    favorites_title: 'Favorites',
    settings: {
      title: 'Settings',
      label: {
        folders_local: 'Show Local Folders',
        folders_system: 'Show System Folders',
        folders_device: 'Show Device Folders',
        on: 'On',
        off: 'Off',
      },
    },
    sync: {
      start: 'The process of synchronizing folders/files is in progress',
    },
    upload: 'Upload',
    upload_file: 'Upload File',
    adopt: 'Adopt',
    download: 'Download',
    resolve: 'Resolve',
    damaged: 'Damaged',
    damaged_reason: 'Errors during',
  },

  dashboard: {
    toolbar: {
      action: {
        shift_path_left: 'Shift left',
        shift_path_right: 'Shift right',
      },
      tooltip: {
        table_view: 'Table view',
        tile_view: 'Tile view',
        split_mode: 'Split mode',
        simple_mode: 'Simple mode',
      },
    },
  },

  validation: {
    text: {
      required: 'This field is required. ',
      equality: 'The old and new values must not be equal. ',
      length: 'No more then {length} characters ',
    },
  },

  dialog: {
    upload_files: {
      text1: 'Your files will be uploaded to the next folder',
      text2: `You can <b>Drag & Drop</b> files here or`,
    },
    warning: {
      title: 'Warning',
    },
    button: {
      confirm: 'Done',
      cancel: 'Cancel',
    },
    confirmation: {
      text: 'Are you sure?',
    },
    create_folder: {
      title: 'Create Folder',
      button: {
        confirm: 'Create',
      },
    },
    rename_folder: {
      title: 'Rename Folder',
      field: {
        placeholder: {
          input: 'Enter Name',
        },
      },
    },
    rename_file: {
      title: 'Rename File',
    },
    resolve: {
      title: 'Conflict Resolving Tool',
      btn: {
        compare: 'Compare',
        back: 'Back',
        keep_cloud: 'Keep Cloud',
        keep_local: 'Keep Local',
        keep_both: 'Keep Both',
        merge: 'Merge',
        absorb: 'Absorb Remote',
        absorb_tooltip: 'By clicking this button you absorb remote changes to local folder.',
      },
      cloud_text: 'Cloud',
      local_text: 'Local',
      checkbox_text: 'Keep this option for all conflicting objects',
    },
    restore: {
      text: 'There is already an object named "{name}" in this folder | There are already objects named "{name}" in this folder',
      question: 'Do you want to replace it? | Do you want to replace them?',
    },
    file_exist: {
      title: 'File already exists',
      placeholder: {
        new_name: 'New file name',
      },
      warning: 'already exists in this folder. Overwrite it, or choose a different name?',
      button: {
        rename: 'Rename',
        cancel: '@:dialog.button.cancel',
        change: 'Change',
        overwrite: 'Overwrite',
      },
    },
  },

  folder_banner: {
    text: {
      resolve_root: 'Please resolve conflict at the Home directory',
      resolve_trash: 'Please resolve conflict at the Trash directory',
    },
  },

  favorite_folder: {
    warning: {
      missing_text: 'The favorite folder "{path}" you want to open is missing (maybe deleted or moved)',
      missing_question: 'Remove the selected folder from the favorites list?',
    },
  },

  fs: {
    folder_name: {
      user_synced_home: 'Home',
      user_local_home: 'Home (local)',
      user_synced_recent: 'Recent',
      user_synced_trash: 'Trash',
      user_local_trash: 'Trash (local)',
    },
    table: {
      header: {
        name: 'Name',
        type: 'Type',
        size: 'Size',
        sync: 'Sync',
        date: 'Date',
      },
      folder: {
        empty_shorttext: 'The folder is empty',
        empty_text: 'The folder is empty, you can Drag & Drop files here or',
      },
    },
    tile: {
      header: {
        text_default: 'Click to Active',
        text_active: 'Active Panel',
      },
    },
    entity: {
      sorting_text: 'Sorting',
      info: {
        type: 'Type',
        type_folder: 'Folder',
        type_file: 'File',
        type_link: 'Link',
        path: 'Path',
        size: 'Size',
        date: 'Created',
        changes: 'Updated',
        tags: 'Tags',
        status: 'Sync Status',
        calculate_hash: 'Calculate hash',
      },
      button: {
        restore_replace: 'Replace',
        restore_keep: 'Keep both',
      },
      message: {
        success: {
          delete:
            'The selected object has been successfully deleted. | The selected objects ({count}) have been successfully deleted.',
          restore: 'The selected objects have been successfully restored.',
          download:
            'The selected object has been successfully downloaded. | The selected objects ({count}) have been successfully downloaded.',
          copy: 'The selected object has been successfully copied. | The selected objects ({count}) have been successfully copied.',
          move: 'The selected object has been successfully moved. | The selected objects ({count}) have been successfully moved.',
        },
        error: {
          delete:
            'Error while deleting the selected object. | Error while deleting the selected objects ({count}).',
          restore: 'Error while restoring the selected objects',
          download:
            'Error while downloading the selected object. | Error while downloading the selected objects ({count}).',
          copy: 'Error while copying the selected object. | Error while copying the selected objects ({count}).',
          move: 'Error while moving the selected object. | Error while moving the selected objects ({count}).',
          open: 'Could not open "{name}"',
        },
      },
    },
    action: {
      copy_label: 'Copy',
      move_label: 'Move',
      copying: 'Copying',
      moving: 'Moving',
    },
    bulk_action: {
      tooltip: {
        set_favorite: 'Mark as/Unmark as Favorite folder',
        download: 'Download selected objects',
        resolve: 'Resolve conflicts for selected objects',
        delete: 'Delete selected objects to the Trash folder',
        delete_completely: 'Permanently delete selected objects',
        restore: 'Restore selected objects',
        copy_move: 'Copy/Move selected objects',
      },
    },
    permanently_delete: {
      title: 'Confirm Permanent Deletion',
      warning1: 'Are you sure you want to permanently delete the selected items?',
      warning2: 'This action cannot be undone.',
      button: {
        confirm: 'Delete Completely',
      },
    },
    mount: {
      button: {
        busy: 'Please wait…',
        mount: 'Mount',
        unmount: 'Unmount',
      },
      message: {
        success: {
          mount: 'Folder is mounted',
          unmount: 'Folder is unmounted',
        },
        error: {
          mount: 'Unable to mount folder',
          unmount: 'Unable to unmount folder',
          unmount_unconfirmed: 'Could not confirm that the folder was unmounted. Please check your file manager.',
        },
      },
    },
  },
  file_picker: {
    header: {
      select_file: 'Select Files',
      save_file: 'Save Files',
    },
    message_status: {
      loading: 'Loading...',
      load_error: "Couldn't load this folder.",
    },
    button: {
      cancel: '@:dialog.button.cancel',
      select: 'Select',
      save: 'Save',
      go: 'Go',
      proceed: 'Proceed',
      next: 'Next',
      enter: 'Enter',
    },
    selected_items: 'Items selected',
    sidebar_title: 'Browse',
    tab_3n_storage: '3N Storage',
    notification: {
      error: {
        invalid_filename:
          'Invalid file name. Avoid reserved characters, control characters, and reserved system names.',
        save_file: 'Failed to save file',
        open_file: 'Failed to open the selected file',
        folder_name_collision: 'A folder with that name already exists. Please choose a different name.',
      },
      success: {
        save_file: 'File saved successfully',
      },
    },
    footer: {
      save_as: 'Save as',
    },
    category: {
      home: 'Home',
      device: 'Device',
      system_synced: 'System Synced',
      system_local: 'System Local',
      device_system: 'Device System',
    },
  },
};
