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
    title: 'Contactos',
    sync: {
      status: 'Estado de sincronización',
    },
    status: {
      label: 'Estado',
      connected: {
        online: 'en línea',
        offline: 'desconectado',
      },
      synced: 'sincronizado',
      unsynced: 'no sincronizado',
    },
    exit: 'Cerrar',
    menu: {
      tutorial: 'Repetir tutorial',
      makeBackup: 'Crear copia de seguridad',
      uploadBackup: 'Restaurar desde copia de seguridad',
      exit: 'Cerrar',
    },
    btn: {
      cancel: 'Cancelar',
      save: 'Guardar',
      add: 'Añadir nuevo',
      share: 'Compartir',
    },
    info: {
      status: {
        online: 'Actualmente estás en línea. Todos los cambios realizados anteriormente se sincronizarán.',
        offline:
          'Actualmente estás sin conexión. Todos los cambios permanecerán en este dispositivo hasta que se conecte.',
      },
    },
    warning: {
      label: 'Warning',
      'sync-stuck':
        'La sincronización no se ha reanudado, aunque este dispositivo está en línea. Los cambios se mantienen en este dispositivo. Reinicia la aplicación para sincronizarlos.',
      'changes-not-published':
        'Los cambios realizados en este dispositivo se guardan aquí, pero el servidor sigue rechazándolos. No se han perdido y se publicarán en cuanto el servidor vuelva a aceptarlos. A veces, reiniciar la aplicación ayuda.',
      'first-run-needs-network':
        'Esta aplicación debe iniciarse una vez mientras haya conexión a Internet: no se puede crear su almacenamiento en este dispositivo sin el servidor. Conéctate e inicia la aplicación de nuevo.',
      'service-unavailable': 'El servicio de contactos no se ha iniciado. Reinicia la aplicación.',
    },
  },
  action: {
    select: {
      all: 'Seleccionar todo',
    },
    deselect: {
      all: 'Deseleccionar todo',
    },
    open: {
      chat: {
        tooltip: 'Abrir un chat con el contacto',
      },
      mail: {
        tooltip: 'Crear un mensaje para el contacto',
      },
    },
    show: {
      keys: {
        own: 'Mostrar información de tus propias claves',
        contact: 'Mostrar información de las claves del contacto',
      },
    },
  },
  confirmation: {
    warning: 'Advertencia',
    delete: {
      one: 'Estás intentando eliminar el contacto {name}. Esta operación eliminará todas las actividades del usuario.',
      multiple:
        'Estás intentando eliminar {count} contactos. Esta operación eliminará todas las actividades del usuario.',
    },
  },
  contacts: {
    search: {
      placeholder: 'Buscar en nombres y correos electrónicos de contactos',
    },
    selected: 'Seleccionados: {number}',
  },
  contact: {
    action: {
      delete: 'Eliminar contacto',
      block: 'Añadir a la lista de bloqueo',
      unblock: 'Eliminar de la lista de bloqueo',
    },
    block: {
      dialogText: 'Estás intentando añadir a {contact} a la lista de bloqueo',
      error: 'Error al bloquear el contacto con ID "{id}"',
      confirmBtn: 'Bloquear',
      mark: 'Bloqueado',
    },
    unblock: {
      dialogText: 'Estás intentando eliminar a {contact} de la lista de bloqueo',
      error: 'Error al desbloquear el contacto con ID "{id}"',
      confirmBtn: 'Desbloquear',
    },
    delete: {
      title: 'Eliminar contacto | Eliminar contactos',
      confirmBtn: 'Eliminar',
      cancelBtn: 'Cancelar',
      success: 'El contacto se ha eliminado. | Los contactos se han eliminado.',
      error:
        'Error al eliminar el contacto. Contacta con soporte. | Error al eliminar los contactos. Contacta con soporte.',
    },
    upsert: {
      success: 'El contacto se ha guardado.',
      error: 'Error al guardar el contacto. Contacta con soporte.',
    },
    placeholder: 'Selecciona un usuario para ver los detalles',
    avatar: {
      upload: 'Subir imagen',
      delete: 'Eliminar imagen',
    },
    content: {
      identity: 'Identidad',
      name: 'Nombre',
      phone: 'Teléfono',
      note: 'Nota',
    },
    myself: {
      name: 'Yo',
    },
    dialog: {
      title: {
        'own-keys': 'Mis claves',
        'contact-keys': 'Claves de {contact}',
      },
    },
  },
  validation: {
    text: {
      required: 'Este campo es obligatorio.',
      mail: 'Dirección de correo electrónico no válida.',
      usage: 'Esta dirección de correo electrónico ya está en uso.',
    },
  },
  'keys-info': {
    'key-on-server': {
      'no-key':
        'No hay ninguna clave pública de introducción en el servidor. Sin esta clave, las personas nuevas no podrán enviarte mensajes, mientras que los contactos existentes con cadenas de claves de comunicación establecidas podrán seguir enviándote mensajes.',
      section: 'Clave pública de introducción en el servidor ASMail',
      btn: {
        'make-new': 'Crear nueva clave',
        update: 'Actualizar clave',
        remove: 'Retirar la llave',
      },
    },
    'sending-key-pair': 'Par de claves para el envío',
    'receiving-key-pair-in-use': 'Par de llaves en uso para recepción',
    'receiving-key-pair-suggested': 'Se sugiere el siguiente par de claves para la recepción.',
    'receiving-key-pair-old': 'Par de claves anterior para recibir',
    'no-contact-keys': 'No hay claves disponibles para este contacto.',
    'key-id': 'ID de clave',
    'your-key-id': 'Tu ID de clave',
    'contact-key-id': `ID de clave del contacto`,
    'contact-intro-key-id': `ID de clave introductoria del contacto`,
    expiry: 'Expiración',
    alg: 'Algoritmo',
    'mid-certifier': 'Certificar MailerId',
    timestamp: 'Marca de tiempo',
    'last-msg-ts': 'Utilizado por última vez el',
    'num-of-sent-msgs': 'Número de mensajes enviados',
    'received-msgs': 'Mensajes recibidos',
    'random-pids': 'ID de pares aleatorizados',
  },
  reachability: {
    'not-present-at-domain':
      'No existe ninguna cuenta con ese nombre en dicho dominio, por lo que {mail} no puede recibir mensajes. Comprueba la dirección.',
    'no-service-for-domain':
      'Ese dominio no ejecuta ningún servicio de mensajería 3NWeb, por lo que {mail} no puede recibir mensajes.',
    'access-restricted':
      '{mail} existe, pero restringe quién puede escribirle; por tanto, es posible que tu mensaje no sea aceptado.',
    offline: 'Disponible cuando esté en línea.',
    'contact-not-saved': 'Disponible después de guardar el contacto.',
  },
  backup: {
    passphrase: {
      createTitle: 'Proteger la copia de seguridad',
      openTitle: 'Se requiere una frase de contraseña',
      createHint: 'Una frase de contraseña cifra el archivo. Deja ambos campos vacíos para guardarlo sin cifrar.',
      openHint:
        'Este archivo de copia de seguridad está cifrado. Introduce la frase de contraseña con la que se creó.',
      label: 'Frase de contraseña',
      repeatLabel: 'Repetir frase de contraseña',
      placeholder: 'Dejar vacío para no cifrar',
      openBtn: 'Abrir',
      show: 'Mostrar frase de contraseña',
      hide: 'Ocultar frase de contraseña',
      wrong: 'La frase de contraseña no permite abrir este archivo.',
      mismatch: 'Las dos frases de contraseña no coinciden.',
      tooShort: 'La frase de contraseña debe tener al menos {count} caracteres.',
      noRecovery: 'No se puede recuperar una frase de contraseña olvidada: el archivo permanecerá ilegible.',
      optional:
        'Sin una frase de contraseña, la privacidad del archivo depende únicamente del lugar donde lo guardes.',
    },
    create: {
      dialogTitle: 'Creando copia de seguridad',
      fileDialogTitle: 'Guardar copia de seguridad',
      fileDialogBtn: 'Guardar',
      text: {
        scanning: 'Leyendo la agenda de contactos',
        compressing: 'Comprimiendo {number} de {total}',
        encrypting: 'Cifrando el archivo',
        saving: 'Guardando el archivo de copia de seguridad',
      },
      success: 'La copia de seguridad {filename} se ha guardado.',
      empty: 'No hay nada de lo que hacer una copia de seguridad.',
      cancel: 'Se ha cancelado la creación de la copia de seguridad.',
      error: 'No se ha podido crear la copia de seguridad.',
    },
    restore: {
      dialogTitle: 'Restaurando copia de seguridad',
      fileDialogTitle: 'Seleccionar archivo de copia de seguridad',
      fileDialogBtn: 'Abrir',
      confirmTitle: 'Confirmar restauración',
      confirmText:
        'La restauración reemplazará tus {current} contactos por los {archived} contactos de esta copia de seguridad. Los contactos que no estén en la copia de seguridad se eliminarán. Esta acción no se puede deshacer.',
      confirmBtn: 'Restaurar',
      confirmWarningTitle: 'Advertencia de compatibilidad',
      confirmWarningText:
        'Este archivo fue creado con la versión {archiveVersion}, mientras que esta aplicación utiliza la versión {appVersion}, o bien el archivo no contiene información sobre su versión. Restaurarlo podría dañar la agenda de contactos. ¿Deseas continuar bajo tu propia responsabilidad?',
      confirmAtOwnRiskBtn: 'Restaurar de todos modos',
      unknownVersion: 'desconocida',
      text: {
        unpacking: 'Leyendo el archivo',
        decrypting: 'Descifrando el archivo',
        restoringImages: 'Restaurando imagen {number} de {total}',
        restoringContacts: 'Restaurando {total} contactos',
        syncing: 'Sincronizando los datos restaurados',
        syncDeferred: 'Restaurado en este dispositivo; se sincronizará más tarde',
        completed: 'Restauración completada',
      },
      success: 'La copia de seguridad se ha restaurado.',
      error: 'No se ha podido restaurar la copia de seguridad.',
      errorCorruptedArchive: 'Este archivo está dañado o no es un archivo ZIP.',
      errorForeignArchive: 'Este archivo es una copia de seguridad de otra aplicación, no de Contactos.',
      errorNoContacts:
        'Este archivo no contiene contactos. Es posible que sea una copia de seguridad de otra aplicación.',
      errorUnreadableDb: 'No se pueden leer los contactos de este archivo.',
      errorPassphraseRequired: 'Este archivo está cifrado y necesita su frase de contraseña.',
      errorEncryptionUnsupported: 'Este archivo está cifrado y esta aplicación no puede descifrarlo aquí.',
    },
  },
  qrcode: {
    'share-qr-title': 'Compartir',
    'save-dialog-title': 'Guardar código QR',
    'save-dialog-button': 'Guardar',
    'save-qr-tooltip': 'Guardar / Descargar código QR',
    'share-qr-tooltip': 'Compartir código QR',
    'copy-link-tooltip': 'Copiar enlace',
    'copy-link-text': 'Enlace copiado',
    'save-success': 'Código QR guardado correctamente',
    'save-invalid': 'Formato de imagen no válido',
    'color-qr-tooltip': 'Cambiar color',
    'color-close-panel': 'Cerrar',
    'copy-link-error': 'Error al copiar el enlace',
    'download-qr-error': 'Error al guardar la imagen del código QR',
  },
  share: {
    title: 'Compartir',
    label: 'Destinatario',
    placeholder: 'Seleccionar un destinatario',
    btnLabel: {
      chat: 'Chat',
      mail: 'Correo',
    },
    noChatHint: 'Solo se pueden compartir contactos por chat cuando existe un chat activo con el destinatario.',
    progress: {
      title: 'Compartiendo contactos',
      preparing: 'Preparando el archivo: {number} de {total} contactos',
      sending: {
        chat: 'Enviando el archivo al chat…',
        mail: 'Enviando el archivo al correo…',
      },
      error: 'No se han podido compartir los contactos',
      cancelled: 'Se ha cancelado el envío de los contactos',
    },
  },

  import: {
    title: 'Importación de contactos',
    progress: 'Se han importado {number} de {total} contactos',
    notFound: 'Esta importación de contactos ya ha finalizado o ha caducado. Abre el archivo de nuevo.',
    result: 'Importación de contactos finalizada: añadidos {added}, actualizados {updated}, omitidos {skipped}',
    field: {
      avatar: 'Foto de perfil',
    },
    conflict: {
      title: 'Ya tienes el contacto {mail}',
      current: 'Actual',
      incoming: 'Recibido',
      empty: 'vacío',
      applyToAll: 'Aplicar a todas las coincidencias restantes',
    },
    btn: {
      abort: 'Detener',
      keep: 'Mantener actual',
      incoming: 'Usar recibido',
      byFields: 'Elegir por campos',
      apply: 'Aplicar',
    },
  },

  tutorial: {
    create: 'Pulsa para empezar a crear un nuevo contacto.',
    mobileMenuBtn: 'Pulsa para abrir el menú de la aplicación.',
    meListItem:
      'Así se muestra un elemento de la lista de contactos. Al pulsarlo, podrás abrir el formulario de edición del contacto.',
    'make-backup': 'Al pulsar aquí, iniciarás el proceso de creación de un archivo de copia de seguridad.',
    'upload-backup':
      'Al pulsar aquí, iniciarás el proceso de restauración de los datos de la aplicación desde el archivo de copia de seguridad que hayas seleccionado.',
    'repeat-tutorial': 'Al pulsar aquí, se reiniciará el tutorial.',
  },
};
