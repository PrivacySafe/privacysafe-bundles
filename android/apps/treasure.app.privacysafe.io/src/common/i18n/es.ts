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
  app: {
    title: 'Tesoro',
    menu: {
      makeBackup: 'Crear copia de seguridad',
      uploadBackup: 'Cargar copia de seguridad',
      exit: 'Salir',
    },
    status: {
      label: 'Estado',
      online: 'En línea',
      offline: 'Desconectado',
    },
    btn: {
      close: 'Cerrar',
      cancel: 'Cancelar',
      save: 'Guardar',
      apply_crop: 'Aplicar recorte',
    },
  },
  list: {
    create: 'Nuevo registro',
    createGroup: 'Nuevo grupo',
    editGroup: 'Editar grupo',
    editRecord: 'Editar registro',
    addToFavorites: 'Añadir a favoritos',
    removeFromFavorites: 'Eliminar de favoritos',
    copyUsername: 'Copiar nombre de usuario',
    copyPassword: 'Copiar contraseña',
    copyCardNumber: 'Copiar número de tarjeta',
    copyCardHolder: 'Copiar titular de la tarjeta',
    copyCardExp: 'Copiar fecha de vencimiento',
    copyCardCvv: 'Copiar CVV',
    copyRecord: 'Copiar registro',
    all: 'Todos los registros',
    recent: 'Recientes',
    bank_cards: 'Tarjetas bancarias',
    cards: 'Tarjetas personalizadas',
    favorites: 'Favoritos',
    search: 'Buscar registros',
    noData: 'No hay registros aquí',
    notifications: {
      success: {
        saving: 'El {entity} se guardó correctamente.',
        deleting: 'El {entity} se eliminó correctamente.',
      },
      error: {
        saving: `Ups. Error al guardar {entity} '{name}'. Inténtalo de nuevo más tarde, por favor.`,
        deleting: `Ups. Error al eliminar {entity} '{name}'. Inténtalo de nuevo más tarde, por favor.`,
      },
      warning: {
        delete: 'No puedes eliminar el grupo porque contiene registros.',
      },
    },
  },
  recordDialog: {
    title: {
      add: 'Añadir nuevo registro',
      add_card: 'Añadir nueva tarjeta',
      add_bank_card: 'Añadir nueva tarjeta bancaria',
      edit: 'Detalles del registro',
      edit_card: 'Detalles de la tarjeta',
      edit_bank_card: 'Detalles de la tarjeta bancaria',
    },
    btn: {
      close: 'Cerrar',
      create: 'Crear',
      discard: 'Descartar',
      save: 'Guardar cambios',
      delete: 'Eliminar registro',
      switch_to: 'Cambiar a',
    },
    form: {
      fields: {
        name: {
          label: 'Nombre del servicio',
          placeholder: 'Introduce el nombre del registro actual',
        },
        resource: {
          label: 'Recurso',
          placeholder: 'Introduce el nombre o dominio del recurso del registro actual',
          required: 'El campo de recurso no puede estar vacío.',
          unique: 'Ya existe un registro con los mismos valores en los campos de recurso y nombre de usuario.',
        },
        username: {
          label: 'Nombre de usuario',
          placeholder: 'Introduce el nombre de usuario para el recurso seleccionado',
          required: 'El campo de nombre de usuario no puede estar vacío.',
          unique: 'Ya existe un registro con los mismos valores en los campos de nombre de usuario y recurso.',
        },
        password: {
          label: 'Contraseña',
          placeholder: 'Introduce la contraseña',
          required: 'El campo de contraseña no puede estar vacío.',
        },
        group: {
          label: 'Grupo',
          placeholder: 'Selecciona el grupo',
        },
        cardName: {
          label: 'Nombre de la tarjeta',
          placeholder: 'Introduce el nombre de la tarjeta actual',
          required: 'El campo del nombre de la tarjeta no puede estar vacío.',
          unique: 'Ya existe una tarjeta con el mismo nombre.',
        },
        bancCardName: {
          label: 'Nombre de la tarjeta bancaria',
          placeholder: 'Introduce el nombre de la tarjeta bancaria actual',
          required: 'El campo del nombre de la tarjeta bancaria no puede estar vacío.',
        },
        cardNumber: {
          label: 'Número de tarjeta',
          placeholder: 'XXXX XXXX XXXX XXXX',
          required: 'El campo del número de tarjeta no puede estar vacío.',
          length: 'El número de tarjeta debe constar de 16 dígitos.',
        },
        cardHolder: {
          label: 'Titular de la tarjeta',
          placeholder: 'NOMBRE COMPLETO',
          required: 'El campo del titular de la tarjeta no puede estar vacío.',
        },
        cardExp: {
          label: 'Fecha de vencimiento',
          placeholder: 'MM/AA',
          required: 'El campo de la fecha de vencimiento no puede estar vacío.',
          format: 'El valor del campo no coincide con el formato (MM/AA).',
          month: 'El mes debe estar comprendido entre 01 y 12.',
        },
        cardCvv: {
          label: 'CVV',
          placeholder: '123',
          required: 'El campo CVV no puede estar vacío.',
          length: 'El valor del campo debe contener 3 o 4 dígitos.',
        },
      },
      btns: {
        generate: 'Generar contraseña',
      },
      image: {
        upload_btn: 'Subir imágenes',
        upload_area: 'Haz clic en esta área para subir imágenes',
        info: 'Máximo 10 archivos de imagen en formatos compatibles (png, jpeg, jpg)',
        uploading: 'Subiendo',
        message: {
          unsupported: 'Estos archivos no son compatibles: {list}',
          limit:
            'El número total de imágenes superará el límite permitido. Algunas imágenes nuevas no se subirán.',
        },
        upload_custom_card_images: 'Seleccionar imágenes de la tarjeta',
        upload_images_btn: 'Subir',
      },
    },
    record_type: {
      password: 'Registro de contraseña',
      card: 'Tarjeta personalizada',
      bank_card: 'Tarjeta bancaria',
    },
    text: {
      or: 'o',
    },
  },
  groupDialog: {
    title: {
      add: 'Añadir nuevo grupo',
      edit: 'Detalles del grupo',
    },
    btn: {
      close: 'Cerrar',
      create: 'Crear',
      save: 'Guardar cambios',
      delete: 'Eliminar grupo',
    },
    form: {
      fields: {
        name: {
          label: 'Nombre del grupo',
          placeholder: 'Introduce el nombre del grupo',
          required: 'El campo del nombre del grupo no puede estar vacío.',
          unique: 'Ya existe un grupo con el mismo nombre.',
        },
        description: {
          label: 'Descripción del grupo',
          placeholder: 'Introduce la descripción del grupo',
        },
      },
    },
  },
  confirmationDeleteGroupDialog: {
    title: 'Eliminar grupo',
    text: '¿Estás seguro de que deseas eliminar este grupo?',
    confirmButtonText: 'Eliminar',
    cancelButtonText: 'Cancelar',
  },
  confirmationDeleteRecordDialog: {
    title: 'Eliminar registro',
    text: '¿Estás seguro de que deseas eliminar este registro?',
    confirmButtonText: 'Eliminar',
    cancelButtonText: 'Cancelar',
  },
  treasuresTable: {
    header: {
      name: 'Nombre',
      sync: 'Sincronización',
      username: 'Nombre de usuario / Nombre del titular / Foto',
      holderName: 'Nombre del titular',
      photo: 'Foto',
      password: 'Contraseña / CVV',
      cvv: 'CVV',
    },
    nodata: 'No hay registros en el grupo actual.',
    row: {
      copiedBtn: 'Copiado',
      duplicateTooltip: 'Hay otro registro con los mismos valores de `resource` y `username`.',
    },
  },
  backup: {
    passphrase: {
      createTitle: 'Proteger la copia de seguridad',
      openTitle: 'Se requiere una frase de contraseña',
      createHint: 'Una frase de contraseña cifra el archivo. Deja ambos campos vacíos para guardarlo sin cifrar.',
      openHint: 'Esta copia de seguridad está cifrada. Introduce la frase de contraseña con la que se creó.',
      label: 'Frase de contraseña',
      repeatLabel: 'Repetir frase de contraseña',
      placeholder: 'Déjalo vacío para no cifrar',
      openBtn: 'Abrir',
      show: 'Mostrar frase de contraseña',
      hide: 'Ocultar frase de contraseña',
      wrong: 'Esta frase de contraseña no permite abrir el archivo.',
      mismatch: 'Las dos frases de contraseña no coinciden.',
      tooShort: 'La frase de contraseña debe tener al menos {count} caracteres.',
      noRecovery: 'No es posible recuperar una frase de contraseña olvidada: el archivo seguirá siendo ilegible.',
      optional:
        'Sin una frase de contraseña, la privacidad del archivo dependerá únicamente del lugar donde lo guardes.',
    },
    create: {
      dialogTitle: 'Creando copia de seguridad',
      fileDialogTitle: 'Guardar copia de seguridad',
      fileDialogBtn: 'Guardar',
      text: {
        scanning: 'Analizando el sistema de archivos',
        compressing: 'Comprimiendo el archivo {number} de {total}',
        encrypting: 'Cifrando el archivo de copia de seguridad',
        saving: 'Guardando el archivo de copia de seguridad',
      },
      success: 'La copia de seguridad {filename} se creó y guardó correctamente.',
      warning: 'No hay datos para realizar la copia de seguridad.',
      cancel: 'El usuario interrumpió el proceso de copia de seguridad.',
      error: 'Se produjo un error al crear el archivo de copia de seguridad.',
    },
    restore: {
      dialogTitle: 'Restaurar copia de seguridad',
      fileDialogTitle: 'Seleccionar archivo de copia de seguridad',
      fileDialogBtn: 'Abrir',
      confirmTitle: 'Confirmar restauración de datos',
      confirmText:
        'Restaurar desde la copia de seguridad (versión {version}) reemplazará todas las contraseñas, tarjetas y grupos actuales. Esta acción no se puede deshacer. ¿Deseas continuar?',
      confirmBtn: 'Restaurar',
      confirmWarningTitle: 'Advertencia de compatibilidad',
      confirmWarningText:
        'La versión del archivo de copia de seguridad ({archiveVersion}) no es totalmente compatible con la versión de la aplicación ({appVersion}), o faltan metadatos. Restaurar este archivo puede dañar los datos de la aplicación o provocar errores. ¿Deseas continuar bajo tu propia responsabilidad?',
      confirmAtOwnRiskBtn: 'Restaurar bajo mi responsabilidad',
      text: {
        unpacking: 'Descomprimiendo y leyendo el archivo',
        decrypting: 'Descifrando el archivo',
        restoring: 'Restaurando el archivo {number} de {total}',
        syncing: 'Sincronizando los datos restaurados',
        syncingWithCount: 'Sincronizando el archivo {number} de {total}',
        completed: 'Restauración completada',
      },
      success: 'La copia de seguridad se restauró correctamente.',
      error: 'Se produjo un error al restaurar la copia de seguridad.',
      errorCorruptedArchive:
        'No se pudo leer el archivo de copia de seguridad: está dañado o no es un archivo ZIP válido.',
      errorForeignArchive:
        'Este archivo no contiene datos de Treasure. Es posible que sea una copia de seguridad de otra aplicación.',
      errorPassphraseRequired: 'Este archivo está cifrado y requiere su frase de contraseña.',
      errorEncryptionUnsupported: 'Este archivo está cifrado y esta aplicación no puede descifrarlo aquí.',
    },
  },
};
