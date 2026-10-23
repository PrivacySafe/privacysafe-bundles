export const es = {
  app: {
    title: 'Bandeja de entrada',
    status: {
      label: 'Estado',
      connected: {
        online: 'en línea',
        offline: 'sin conexión',
      },
    },
    startup: {
      starting: 'A partir de ...',
      'migrating-db': 'Mover el buzón a este dispositivo ...',
      'migrating-files': 'Mover archivos adjuntos a este dispositivo: {done} de {total}',
      loading: 'Cargando mensajes ...',
    },
    sync: {
      syncing: 'Sincronización con sus otros dispositivos…',
      syncing_count: 'Sincronización con sus otros dispositivos… ({count} restante)',
      // Said only when a pass has actually failed: this is the one state the
      // user can do something about, so it is worded as waiting rather than as
      // breakage.
      stalled: 'Hay cambios pendientes de envío.',
    },
    select: 'Seleccionar',
    ok: 'Aceptar',
    new: {
      mail: 'Correo nuevo',
    },
    menu: {
      manageBlocks: 'Gestionar bloques',
      makeBackup: 'Crear una copia de seguridad',
      restoreBackup: 'Restaurar desde una copia de seguridad',
      exit: 'Salida',
    },
    btn: {
      cancel: 'Cancelar',
      save: 'Guardar',
      back: 'Atrás',
      continue: 'Continuar',
      send: 'Enviar',
    },
  },

  backup: {
    // One set of lines for both places the same fact is told: after a backup,
    // and before a restore of one.
    skipped: {
      onAnotherDevice:
        '{count} Se adjuntaron archivos en otro de tus dispositivos y los bytes de los archivos nunca se transmiten. ' +
        'entre dispositivos.',
      notRequested: '{count} Se excluyeron archivos porque solicitaste un archivo comprimido sin ellos.',
      external:
        '{count} Se excluiron archivos porque solicitaste un archivo comprimido sin ellos., así que el ' +
        'El archivo los señala en lugar de retenerlos.',
      origin: '{count} Los archivos pertenecen a mensajes recibidos y permanecen en el servidor.',
      unreadable: '{count} No se pudo leer el archivo (o los archivos).',
      noLocalSource: '{count} El/los archivo(s) no contiene(n) ningún archivo legible en este dispositivo.',
    },
    passphrase: {
      createTitle: 'Proteja la copia de seguridad',
      openTitle: 'Se requiere frase de contraseña',
      createHint: 'Una frase de contraseña cifra el archivo. Deja ambos campos vacíos para guardarlo sin cifrar.',
      openHint:
        'Este archivo de copia de seguridad está cifrado. Introduzca la frase de contraseña con la que se creó.',
      label: 'Frase de contraseña',
      repeatLabel: 'Repetir frase de contraseña',
      placeholder: 'Dejar vacío para no cifrado',
      openBtn: 'Abierto',
      show: 'Mostrar frase de contraseña',
      hide: 'Ocultar frase de contraseña',
      wrong: 'Esa contraseña no abre este archivo.',
      mismatch: 'Las dos frases de contraseña no coinciden.',
      tooShort: 'Una frase de contraseña debe ser al menos {count} Caracteres largos.',
      noRecovery: 'Una frase de contraseña olvidada no se puede recuperar: el archivo permanece ilegible.',
      optional: 'Sin una frase de contraseña, el archivo es tan privado como el lugar donde lo guardas.',
    },
    create: {
      dialogTitle: 'Creando copia de seguridad',
      fileDialogTitle: 'Guardar copia de seguridad',
      fileDialogBtn: 'Ahorrar',
      text: {
        scanning: 'Leer el buzón',
        compressing: 'Embalaje {number} de {total}',
        encrypting: 'Cifrado del archivo',
        saving: 'Guardando el archivo de copia de seguridad',
      },
      // A permanent explanation rather than a warning to confirm: it is not
      // about the risk of this action but about the boundary of what an archive
      // can ever bring back.
      attachmentsNotice:
        'Los archivos adjuntos de los mensajes recibidos se guardan en el servidor y no se envían a la carpeta ' +
        'archivo. Si elimina dicho mensaje del servidor, se perderán sus archivos adjuntos. — el ' +
        'los mensajes en sí seguirán restaurándose.',
      // The line a live run went without: an archive came out with no
      // attachments at all, because the files had been attached on another
      // device and file bytes never travel between devices.
      thisDeviceNotice:
        'Solo los archivos que están en este dispositivo van al archivo. Un mensaje cuyo archivo fue ' +
        '...conectado a otro de tus dispositivos se respalda sin él, así que realiza la copia de seguridad. ' +
        'donde están los archivos.',
      success: 'El respaldo {filename} fue salvado.',
      skippedTitle: 'Algunos archivos no se incluyeron en el archivo comprimido.',
      empty: 'No hay nada que respaldar.',
      cancel: 'Se detuvo la creación de la copia de seguridad.',
      error: 'No se pudo crear la copia de seguridad.',
      errorTooLarge:
        'Este buzón es demasiado grande para ser archivado completo. Realice una copia de seguridad sin ' +
        'archivos adjuntos en su lugar.',
    },
    restore: {
      dialogTitle: 'Restaurando copia de seguridad',
      fileDialogTitle: 'Seleccionar archivo de copia de seguridad',
      fileDialogBtn: 'Abierto',
      confirmTitle: 'Restaurar desde una copia de seguridad',
      confirmBtn: 'Restaurar',
      confirmWarningText:
        'Este archivo fue escrito por la versión {archiveVersion}, y esta aplicación es la versión ' +
        '{appVersion}, o el archivo no contiene ninguna versión. Restaurarlo puede dañarlo ' +
        'buzón. Proceda bajo su propio riesgo..',
      unknownVersion: 'desconocido',
      unknownDate: 'desconocido',
      skippedTitle: 'Este archivo no contiene todos los archivos.:',
      summary: {
        createdAt: 'Copia de seguridad realizada',
        messages: 'Mensajes en el archivo',
        attachments: 'Archivos adjuntos en el archivo',
        current: 'Mensajes aquí ahora',
      },
      modo: {
        mergeTitle: 'Añadir lo que falta',
        mergeHint:
          'Se restauran los mensajes y carpetas que no están aquí. No se modifica ni se elimina ' +
          'nada de lo que ya existe. Un mensaje eliminado después de realizar la copia de seguridad permanecerá eliminado.',
        replaceTitle: 'Hacer que el buzón coincida con el archivo',
        replaceHint:
          'El archivo define el estado del buzón. Cualquier cambio realizado después de la copia de seguridad ' +
          'prevalecerá sobre el contenido del archivo.',
        replaceWarning:
          'Los mensajes y carpetas que no se encuentren en el archivo y que sean más antiguos que este ' +
          'se eliminarán, tanto en este dispositivo como en los demás.',
      },
      devicesNotice:
        'Lo que elijas aquí determinará lo que hará cada uno de tus dispositivos: se envía la restauración. ' +
        'A ellos y aplicados por la misma regla.',
      text: {
        unpacking: 'Leyendo el archivo',
        decrypting: 'Desencriptando el archivo',
        listingInbox: 'Comprobando qué mensajes siguen en el servidor',
        restoringAttachments: 'Restaurando el archivo adjunto {number} de {total}',
        restoringMessages: 'Restaurando {number} de {total}',
        announcing: 'Notificando a tus otros dispositivos',
        completed: 'Restauración completada',
      },
      success:
        'Se restauró la copia de seguridad.: {created} agregado, {updated} actualizado, {deleted} eliminado.',
      offlineNotice:
        'No se pudo contactar con el servidor, por lo que se desconoce cuáles de los mensajes recibidos todavía ' +
        'allá. Es posible que algunos archivos adjuntos no estén disponibles.',
      error: 'No se pudo restaurar la copia de seguridad.',
      errorCorruptedArchive: 'Este archivo está dañado o no es un archivo ZIP.',
      errorForeignArchive: 'Este archivo es una copia de seguridad de otra aplicación, no del buzón de correo.',
      errorNoMessages: 'Este archivo no contiene mensajes. Puede ser una copia de seguridad de otra aplicación.',
      errorUnreadableRecords: 'No se pueden leer los mensajes de este archivo.',
      errorPassphraseRequired: 'Este archivo está cifrado y requiere su frase de contraseña.',
      errorEncryptionUnsupported: 'Este archivo está cifrado y esta aplicación no puede descifrarlo aquí.',
    },
  },

  msg: {
    create: {
      dialog: {
        title: 'Correo nuevo',
      },
      label: {
        from: 'De',
        to: 'Para',
        subject: 'Asunto',
      },
      placeholder: {
        contacts: 'Ingrese un correo estándar o 3NWeb',
        editor: 'Ingrese el texto del mensaje ...',
      },
      recipient: {
        blocked: '{mail} está bloqueado y se eliminó de los destinatarios.',
      },
      btn: {
        attach: 'Adjuntar archivos',
        editor_formating: 'Formato',
        discard: 'Descartar',
        send: 'Enviar',
      },
      report: {
        subject: 'Informe de bandeja de entrada de PrivacySafe',
      },
    },
    text: {
      no_selected: {
        part1: 'Ningún correo seleccionado.',
        part2: 'Seleccione un mensaje para ver su contenido.',
      },
    },
    sending: {
      label: {
        canceled: 'Envío cancelado',
        error: 'Error de envío',
        progress: 'Envío en progreso...',
      },
      error: {
        unknownRecipient: 'destinatario desconocido',
        msgTooBig: 'este mensaje es más grande de lo permitido',
        inboxIsFull: 'el buzón de este destinatario está lleno',
        domainNotFound: 'este dominio no fue encontrado',
        noServiceRecord: 'este dominio no es compatible con 3N',
        recipientPubKeyFailsValidation: 'la clave pública no es válida',
        blocked: 'has bloqueado esta dirección',
        noDescription: 'Sin descripción',
      },
      progress: 'Completo {percent} ({currentValue} de {totalValue})',
    },
    content: {
      preflight_error: 'El mensaje no se pudo enviar a los destinatarios especificados.',
      sending_on_another_device: 'Este mensaje se está enviando desde otro de sus dispositivos.',
      add_address: 'Añadir dirección a los contactos',
      blocked_sender: 'Ha bloqueado esta dirección',
      blocked_reply: 'No puede responder a una dirección bloqueada. Desbloquéela primero.',
      btn: {
        moveToTrash: 'Mover a la papelera',
        deleteForever: 'Eliminar permanentemente',
        attachments_collapse: 'Contraer',
      },
      tooltip: {
        delete: 'Eliminar mensaje',
        resend: 'Reenviar',
        cancel_sending: 'Cancelar envío',
        edit: 'Editar',
        send: 'Enviar',
        download: 'Descargar el archivo',
        download_all: 'Descargar todos los archivos',
        view: 'Ver el archivo',
        make_preview: 'Mostrar una vista previa (lee todo el archivo)',
        reply: 'Responder',
        replyAll: 'Responder a todos',
        forward: 'Reenviar',
        restore: 'Restaurar',
        // Worded as in chat.app, for the reason given over `dialog.label`.
        block: 'Bloquear usuario',
        unblock: 'Desbloquear usuario',
        report: 'Reportar',
      },
      editor: {
        fontSize: 'Tamaño de fuente',
        fontSize_header: 'Encabezado',
        fontSize_normal: 'Normal',
        bold: 'Negrita',
        unbold: 'Quitar negrita',
        italic: 'Cursiva',
        noItalic: 'Quitar cursiva',
        underline: 'Subrayado',
        noUnderline: 'Quitar subrayado',
        strikethrough: 'Tachado',
        noStrikethrough: 'Quitar tachado',
        ordered: 'Lista ordenada',
        unordered: 'Lista desordenada',
        noList: 'Quitar lista',
        decreaseListLevel: 'Disminuir nivel de lista',
        increaseListLevel: 'Aumentar nivel de lista',
        align_left: 'Alinear a la izquierda',
        align_right: 'Alinear a la derecha',
        align_center: 'Centrar',
        align_justify: 'Justificar',
        quote: 'Cita de bloque',
        code: 'Código',
        noCode: 'Quitar código',
      },
    },
    actions: {
      select_all: 'Seleccionar todo',
      deselect_all: 'Deseleccionar todo',
      selected: 'Seleccionados',
      cancel: 'Cancelar',
      cancel_tooltip: 'Restablecer mensajes marcados',
    },
    permanent_delete: {
      title: 'Confirmar eliminación permanente',
      string1: '¿Está seguro de que desea eliminar permanentemente el/los mensaje(s) seleccionado(s)?',
      string2: 'Esta acción no se puede deshacer.',
      confirm_button: 'Eliminar completamente',
    },
    download: {
      title: 'Seleccione una carpeta para descargar',
      file_title: 'Guardar archivo',
    },
    preflight_dialog: {
      title: 'Procesamiento previo al envío',
      processing_text:
        'Preparando para enviar... Comprobando la disponibilidad del destinatario. Por favor, espere.',
      subtitle: 'La siguiente dirección no está disponible actualmente y no se le pueden entregar mensajes:',
      question: '¿Desea enviar el mensaje de todos modos?',
      confirm_button: 'Enviar de todos modos',
    },
    reply_title: 'Mensaje original',
    forward_title: 'Mensaje reenviado',
    attachments: {
      writing: {
        success: 'Los archivos adjuntos se han guardado',
        error: 'Error al escribir los archivos adjuntos',
      },
      removing: {
        error: 'Error al eliminar los archivos adjuntos',
      },
      linking: {
        error: 'Error al abrir los archivos adjuntos de este borrador',
      },
      on_another_device: 'Estos archivos se adjuntaron en otro de tus dispositivos y no están disponibles aquí.',
      partially_downloaded: 'Se guardaron {done} de {total} archivos; el resto está en otro de tus dispositivos.',
    },
    attachment: {
      writing: {
        success: 'El archivo {fileName} se ha guardado',
        error: 'Error al escribir el archivo {fileName}',
      },
      attaching: {
        error: 'Error al adjuntar el archivo {fileName}',
      },
      too_big: {
        error: 'El archivo {fileName} supera el límite de {limit} y no se puede adjuntar',
      },
      unavailable:
        'No se puede leer el archivo {fileName}; parece que fue eliminado, movido o renombrado. Adjúntalo de nuevo para enviar este mensaje.',
      link_broken: 'No se puede mostrar el archivo {fileName}; parece que fue eliminado, movido o renombrado.',
      on_another_device: 'El archivo {fileName} se adjuntó en otro de tus dispositivos y no está disponible aquí.',
      on_another_device_short: 'En otro dispositivo',
      loading: '{done} de {total}',
      loading_cancel: 'Cancelar',
      removing: {
        error: 'Error al eliminar el archivo {fileName}',
      },
      view_exit: 'Salir de la vista',
    },
  },

  folder: {
    empty: {
      title: 'La carpeta está vacía',
      text: {
        inbox:
          'La carpeta Bandeja de entrada almacena todos los correos electrónicos entrantes que ha recibido de los servicios de 3NWeb y de los servicios de correo tradicionales.',
        outbox:
          'La carpeta Bandeja de salida almacena temporalmente los correos electrónicos que se han enviado pero que aún están en proceso de entrega.',
        draft:
          'La carpeta de borradores contiene los correos electrónicos que empezaste a escribir pero aún no has enviado; se guardan para que puedas terminarlos y enviarlos más tarde.',
        sent: 'La carpeta «Enviados» contiene copias de los correos electrónicos que has enviado correctamente a otras personas.',
        trash:
          'La carpeta Papelera almacena temporalmente los correos electrónicos eliminados. Los mensajes permanecen allí hasta que se eliminan definitivamente, ya sea de forma manual o tras un periodo determinado.',
      },
    },
  },

  confirmation: {
    dialog: {
      text: 'Estas seguro',
    },
  },

  dialog: {
    'open-file': {
      'image-type': 'Images',
    },
    // Worded as in chat.app: one blacklist, told about in one voice, whichever
    // app the user happens to be blocking from.
    label: {
      warning: 'Advertencia',
    },
    button: {
      block: 'Bloquear',
      unblock: 'Desatascar',
      cancel: 'Cancelar',
      close: 'Cerca',
    },
    text: {
      block: '¿Bloquear al usuario {mail}?',
      unblock: '¿Desbloquear al usuario {mail}?',
    },
    additionalText: {
      block:
        'Ya no podrán enviarte mensajes ni llamarte a través de PrivacySafe.' +
        '<br>Los mensajes existentes permanecerán en tu buzón.',
      unblock: 'Podrán volver a enviarte mensajes y llamarte a través de PrivacySafe.',
    },

    'report-dialog': {
      title: 'Denunciar un mensaje o un remitente',
      // On the phone the form is a page, and the line above does not fit
      // between the arrow back and the button that sends.
      pageTitle: 'Informe',
      content: {
        'reasons-label': 'Cuéntanos por qué lo estás denunciando.',
        reason: {
          label: 'Razón',
          spam: 'Correo basura',
          harassment: 'Acoso o amenazas',
          fraud: 'Suplantación de identidad o fraude',
          activity: 'Actividad perjudicial o ilegal',
          other: 'Otro',
        },
        fieldsetLabel: 'Esto revelará el contenido del mensaje reportado al equipo de abuso de PrivacySafe.',
        reportedMessage: '¿Incluir el mensaje reportado?',
        reportedAttachments: '¿Incluir los archivos adjuntos del mensaje reportado?',
        step2SubTitle: 'El mensaje de tu informe',
        step2Preamble: 'Me gustaría reportar un mensaje o un remitente de PrivacySafe Inbox.',
        step2Additional: 'Detalles adicionales',
        step2Block: '¿Te gustaría también bloquear a este remitente?',
        // Who is being reported, and when their message came, are in every
        // report: the toggle above discloses the contents of the message, and a
        // complaint about nobody is one the abuse team can do nothing with.
        reportedSender: 'Remitente denunciado',
        reportedReceivedAt: 'Recibido',
        reportedMsgId: 'ID del mensaje',
        reportedMessageTitle: 'Mensaje reportado',
        attachmentsNote: 'Los archivos adjuntos del mensaje reportado se incluyen en este informe.',
        attachmentsFailed: 'No se pudieron adjuntar los archivos adjuntos del mensaje notificado:: {files}',
      },
      notif: {
        noReportAddress: 'Error al recuperar la dirección para enviar el informe',
        reportAddressBlocked:
          'Has bloqueado {mail}, la dirección a la que se envían los informes de este dominio. Desbloquéala para enviar informes.',
        blocked: '{mail} ha sido bloqueado',
        attachmentsError: 'No se pudieron adjuntar al informe algunos archivos adjuntos del mensaje reportado.',
        sending: 'Se está enviando el informe. Su progreso aparece en la Bandeja de salida.',
        sent: 'El informe ha sido enviado.',
        sendError: 'No se pudo enviar el informe.',
      },
    },
  },

  manageBlocks: {
    dialog: {
      title: 'Administrar bloqueos',
      search_placeholder: 'Buscar por nombre o dirección',
      section: {
        contacts: 'Contactos',
        used: 'No están en contactos',
      },
      nobody: 'Ningún resultado coincide con la búsqueda',
    },
  },

  contact: {
    // Said on a row the recipient list shows but refuses to pick, as chat.app
    // says it on a contact it will not start a chat with.
    blocked: {
      mark: 'Bloqueado',
    },
    error: {
      block: 'Error al bloquear al contacto',
      unblock: 'Error al desbloquear al contacto',
    },
  },

  chat: {
    pdf: {
      view: {
        btn: {
          prev: 'Página anterior',
          next: 'Página siguiente',
        },
        page: 'Página',
      },
    },
    player: {
      play: 'Jugar',
      pause: 'Pausa',
    },
    audio: {
      player: {
        visual: {
          setting: 'Configuración de visualización',
          mode1: 'Modo 1',
          mode2: 'Modo 2',
        },
      },
    },
    view: {
      load: {
        file: {
          error: 'Error al cargar el archivo',
        },
      },
    },
  },
};
