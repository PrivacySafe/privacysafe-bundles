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
export const es = {
  '-': '',

  app: {
    title: 'Almacenamiento',
    status: {
      label: 'Estado',
      online: 'En línea',
      offline: 'Desconectado',
    },
    open: 'Abrir',
    exit: 'Salir',
    create: 'Crear',
    create_folder: 'Crear carpeta',
    selected: 'Seleccionado',
    favorites_title: 'Favoritos',
    settings: {
      title: 'Configuración',
      label: {
        folders_local: 'Mostrar carpetas locales',
        folders_system: 'Mostrar carpetas del sistema',
        folders_device: 'Mostrar carpetas del dispositivo',
        on: 'Activado',
        off: 'Desactivado',
      },
    },
    sync: {
      start: 'El proceso de sincronización de carpetas/archivos está en curso',
    },
    upload: 'Subir',
    upload_file: 'Subir archivo',
    adopt: 'Adoptar',
    download: 'Descargar',
    resolve: 'Resolver',
    damaged: 'Dañado',
    damaged_reason: 'Errores durante',
  },

  dashboard: {
    toolbar: {
      action: {
        shift_path_left: 'Mover a la izquierda',
        shift_path_right: 'Mover a la derecha',
      },
      tooltip: {
        table_view: 'Vista de tabla',
        tile_view: 'Vista de mosaicos',
        split_mode: 'Modo dividido',
        simple_mode: 'Modo simple',
      },
    },
  },

  validation: {
    text: {
      required: 'Este campo es obligatorio. ',
      equality: 'El valor anterior y el nuevo no deben ser iguales. ',
      length: 'No más de {length} caracteres ',
    },
  },

  dialog: {
    upload_files: {
      text1: 'Tus archivos se subirán a la siguiente carpeta',
      text2: `Puedes <b>arrastrar y soltar</b> archivos aquí o`,
    },
    warning: {
      title: 'Advertencia',
    },
    button: {
      confirm: 'Listo',
      cancel: 'Cancelar',
    },
    confirmation: {
      text: '¿Estás seguro?',
    },
    create_folder: {
      title: 'Crear carpeta',
      button: {
        confirm: 'Crear',
      },
    },
    rename_folder: {
      title: 'Renombrar carpeta',
      field: {
        placeholder: {
          input: 'Introducir nombre',
        },
      },
    },
    rename_file: {
      title: 'Renombrar archivo',
    },
    resolve: {
      title: 'Herramienta de resolución de conflictos',
      btn: {
        compare: 'Comparar',
        back: 'Atrás',
        keep_cloud: 'Conservar en la nube',
        keep_local: 'Conservar localmente',
        keep_both: 'Conservar ambos',
        merge: 'Combinar',
        absorb: 'Incorporar cambios remotos',
        absorb_tooltip: 'Al hacer clic en este botón, incorporas los cambios remotos a la carpeta local.',
      },
      cloud_text: 'Nube',
      local_text: 'Local',
      checkbox_text: 'Mantener esta opción para todos los elementos en conflicto',
    },
    restore: {
      text: 'Ya existe un objeto llamado "{name}" en esta carpeta | Ya existen objetos llamados "{name}" en esta carpeta',
      question: '¿Deseas reemplazarlo? | ¿Deseas reemplazarlos?',
    },
    file_exist: {
      title: 'El archivo ya existe',
      placeholder: {
        new_name: 'Nuevo nombre de archivo',
      },
      warning: 'ya existe en esta carpeta. ¿Deseas sobrescribirlo o elegir otro nombre?',
      button: {
        rename: 'Renombrar',
        cancel: '@:dialog.button.cancel',
        change: 'Cambiar',
        overwrite: 'Sobrescribir',
      },
    },
  },

  folder_banner: {
    text: {
      resolve_root: 'Resuelve el conflicto en el directorio principal',
      resolve_trash: 'Resuelve el conflicto en el directorio de la papelera',
    },
  },

  favorite_folder: {
    warning: {
      missing_text:
        'La carpeta favorita "{path}" que deseas abrir no existe (es posible que se haya eliminado o movido)',
      missing_question: '¿Deseas eliminar la carpeta seleccionada de la lista de favoritos?',
    },
  },

  fs: {
    folder_name: {
      user_synced_home: 'Inicio',
      user_local_home: 'Inicio (local)',
      user_synced_recent: 'Recientes',
      user_synced_trash: 'Papelera',
      user_local_trash: 'Papelera (local)',
    },
    table: {
      header: {
        name: 'Nombre',
        type: 'Tipo',
        size: 'Tamaño',
        sync: 'Sincronización',
        date: 'Fecha',
      },
      folder: {
        empty_shorttext: 'La carpeta está vacía',
        empty_text: 'La carpeta está vacía, puedes arrastrar y soltar archivos aquí o',
      },
    },
    tile: {
      header: {
        text_default: 'Haz clic para activar',
        text_active: 'Panel activo',
      },
    },
    entity: {
      sorting_text: 'Ordenar',
      info: {
        type: 'Tipo',
        type_folder: 'Carpeta',
        type_file: 'Archivo',
        type_link: 'Enlace',
        path: 'Ruta',
        size: 'Tamaño',
        date: 'Fecha de creación',
        changes: 'Última actualización',
        tags: 'Etiquetas',
        status: 'Estado de sincronización',
        calculate_hash: 'Calcular hash',
      },
      button: {
        restore_replace: 'Reemplazar',
        restore_keep: 'Conservar ambos',
      },
      message: {
        success: {
          delete:
            'El elemento seleccionado se ha eliminado correctamente. | Los elementos seleccionados ({count}) se han eliminado correctamente.',
          restore: 'Los elementos seleccionados se han restaurado correctamente.',
          download:
            'El elemento seleccionado se ha descargado correctamente. | Los elementos seleccionados ({count}) se han descargado correctamente.',
          copy: 'El elemento seleccionado se ha copiado correctamente. | Los elementos seleccionados ({count}) se han copiado correctamente.',
          move: 'El elemento seleccionado se ha movido correctamente. | Los elementos seleccionados ({count}) se han movido correctamente.',
        },
        error: {
          delete:
            'Error al eliminar el elemento seleccionado. | Error al eliminar los elementos seleccionados ({count}).',
          restore: 'Error al restaurar los elementos seleccionados',
          download:
            'Error al descargar el elemento seleccionado. | Error al descargar los elementos seleccionados ({count}).',
          copy: 'Error al copiar el elemento seleccionado. | Error al copiar los elementos seleccionados ({count}).',
          move: 'Error al mover el elemento seleccionado. | Error al mover los elementos seleccionados ({count}).',
          open: 'No se pudo abrir "{name}"',
        },
      },
    },
    action: {
      copy_label: 'Copiar',
      move_label: 'Mover',
      copying: 'Copiando',
      moving: 'Moviendo',
    },
    bulk_action: {
      tooltip: {
        set_favorite: 'Marcar como favorito/Quitar de favoritos',
        download: 'Descargar los elementos seleccionados',
        resolve: 'Resolver conflictos de los elementos seleccionados',
        delete: 'Mover los elementos seleccionados a la papelera',
        delete_completely: 'Eliminar permanentemente los elementos seleccionados',
        restore: 'Restaurar los elementos seleccionados',
        copy_move: 'Copiar/Mover los elementos seleccionados',
      },
    },
    permanently_delete: {
      title: 'Confirmar eliminación permanente',
      warning1: '¿Estás seguro de que deseas eliminar permanentemente los elementos seleccionados?',
      warning2: 'Esta acción no se puede deshacer.',
      button: {
        confirm: 'Eliminar definitivamente',
      },
    },
    mount: {
      button: {
        busy: 'Por favor, espera…',
        mount: 'Montar',
        unmount: 'Desmontar',
      },
      message: {
        success: {
          mount: 'La carpeta se ha montado',
          unmount: 'La carpeta se ha desmontado',
        },
        error: {
          mount: 'No se pudo montar la carpeta',
          unmount: 'No se pudo desmontar la carpeta',
          unmount_unconfirmed:
            'No se pudo confirmar que la carpeta se haya desmontado. Comprueba tu administrador de archivos.',
        },
      },
    },
  },
  file_picker: {
    header: {
      select_file: 'Seleccionar archivos',
      save_file: 'Guardar archivos',
      select_folder: 'Seleccionar carpeta',
      save_folder: 'Guardar carpeta',
    },
    message_status: {
      loading: 'Cargando...',
      load_error: 'No se pudo cargar esta carpeta.',
    },
    button: {
      cancel: '@:dialog.button.cancel',
      select: 'Seleccionar',
      save: 'Guardar',
      go: 'Ir',
      proceed: 'Continuar',
      next: 'Siguiente',
      enter: 'Entrar',
      new_folder: 'Nueva carpeta',
      create: 'Crear',
      use_folder: 'Usar carpeta',
      select_this_folder: 'Seleccionar esta carpeta',
    },
    selected_items: 'Elementos seleccionados',
    sidebar_title: 'Explorar',
    tab_3n_storage: 'Almacenamiento 3N',
    notification: {
      error: {
        invalid_filename:
          'Nombre de archivo no válido. Evita los caracteres reservados, los caracteres de control y los nombres reservados del sistema.',
        save_file: 'No se pudo guardar el archivo',
        open_file: 'No se pudo abrir el archivo seleccionado',
        folder_name_collision: 'Ya existe una carpeta con ese nombre. Elige otro nombre.',
        open_folder: 'No se pudo abrir la carpeta.',
        save_folder: 'No se pudo preparar la carpeta para guardar.',
        create_folder:
          'No se pudo crear la carpeta. Comprueba el nombre y tus permisos de acceso a esta ubicación.',
        folder_create_conflict: 'Ya existe un elemento con este nombre. Elige otro nombre.',
        folder_target_conflict:
          'Ya existe un archivo o enlace con este nombre. Elige otro nombre para la carpeta.',
        folder_unavailable: 'Esta carpeta ya no está disponible. Elige otra carpeta.',
      },
      success: {
        save_file: 'Archivo guardado correctamente',
      },
    },
    footer: {
      save_as: 'Guardar como',
    },
    category: {
      home: 'Inicio',
      device: 'Dispositivo',
      system_synced: 'Sistema sincronizado',
      system_local: 'Sistema local',
      device_system: 'Sistema del dispositivo',
    },
    folder_name: 'Nombre de la carpeta',
    folder_name_empty_hint: 'Déjalo en blanco para usar la carpeta actual.',
    folder_exists: {
      title: 'Usar carpeta existente',
      message:
        'Ya existe una carpeta llamada "{name}". ¿Deseas usar esta carpeta? Se conservará el contenido existente.',
    },
  },
};
