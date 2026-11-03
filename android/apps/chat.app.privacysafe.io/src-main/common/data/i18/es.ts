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
    title: 'Chat',
    status: {
      label: 'Estado',
      connected: {
        online: 'en línea',
        offline: 'desconectado',
      },
    },
    sync: {
      label: 'Sincronizando…',
      labelWithCount: 'Sincronizando… ({count})',
      catchUp: 'Poniéndose al día con los mensajes…',
      stalled: 'Hay cambios pendientes de envío',
      stalledTooltip:
        'Los cambios realizados aquí aún no han llegado a tus otros dispositivos; ' +
        'se conservan y se volverán a enviar',
      tooltip: {
        idle: '',
        'catch-up': 'Recuperando los mensajes recibidos mientras la aplicación estaba cerrada',
        incoming: 'Aplicando los cambios realizados en tus otros dispositivos',
        outgoing: 'Enviando cambios a tus otros dispositivos',
      },
      duplicateInstance:
        'Otra instancia de la aplicación utiliza la misma carpeta de datos, ' +
        'por lo que ambas funcionan como el mismo dispositivo y no pueden sincronizarse entre sí. ' +
        'Inicia la segunda instancia con su propia carpeta de datos.',
    },
    orientation: {
      rotateBack: 'Por favor, vuelve a girar tu teléfono a la orientación vertical.',
    },
    startup: {
      starting: 'Iniciando…',
      stillStarting: 'El servicio en segundo plano del chat todavía se está iniciando ({stage})…',
      unreachableTitle: 'El servicio en segundo plano del chat no responde',
      unreachableText:
        'La aplicación no puede conectarse al servicio que almacena tus chats. ' +
        'Comprueba si vuelve a responder.',
      // The pre-mount screen's own wording: there the connect itself failed, so
      // there is no component to ask, and its Retry is a plain reload.
      connectFailedText:
        'La aplicación no pudo conectarse al servicio que almacena ' +
        'tus chats. Si volver a intentarlo no ayuda, cierra PrivacySafe ' +
        'por completo y vuelve a iniciarla.',
      stillUnreachableText:
        'El servicio sigue sin responder. Recargar esta ' +
        'ventana no servirá de nada: volverá a conectarse al mismo proceso en segundo plano. ' +
        'Cierra PrivacySafe por completo y vuelve a iniciarla.',
      failedTitle: 'No se pudo iniciar el servicio en segundo plano del chat',
      failedText: 'El servicio informó de un error al iniciarse: {reason}',
      checking: 'Comprobando…',
      retry: 'Reintentar',
      closeWindow: 'Cerrar esta ventana',
      listNotLoaded: 'No se pudo cargar la lista de chats.',
    },
    menu: {
      makeBackup: 'Crear una copia de seguridad',
      restoreBackup: 'Restaurar desde una copia de seguridad',
      exit: 'Salir',
    },
    ok: 'Aceptar',
    text: {
      new: 'Nuevo',
      close: 'Cerrar',
      back: 'Atrás',
      next: 'Siguiente',
      create: 'Crear',
      delete: 'Eliminar',
      search: 'Buscar',
      cancel: 'Cancelar',
      save: 'Guardar',
      msg_sender: {
        you: 'Tú',
      },
      send: {
        file: 'archivo(s) enviado(s)',
      },
      receive: {
        file: 'archivo(s) recibido(s)',
      },
    },
    notification: {
      new_message: '{sender} te ha enviado un mensaje',
      new_group_message: '{sender} ha enviado un mensaje al chat «{chatName}»',
      invite: '{sender} te invita',
      group_invite: '{sender} te invita al chat «{chatName}»',
    },
  },

  backup: {
    // One set of lines for both places the same fact is told: after a backup,
    // and before a restore of one.
    skipped: {
      onAnotherDevice:
        '{count} archivo(s) se adjuntaron en otro de tus dispositivos, y los datos de los archivos nunca se transfieren entre dispositivos.',
      notRequested: 'Se omitieron {count} archivo(s) porque solicitaste un archivo comprimido sin ellos.',
      symlink:
        '{count} archivo(s) superan los 20 MiB y se adjuntaron como referencias, por lo que el archivo comprimido apunta a ellos en lugar de contenerlos.',
      inIncomingMsg:
        '{count} archivo(s) pertenecen a mensajes que recibiste y permanecen en tu buzón del servidor.',
      unreadable: 'No se pudieron leer {count} archivo(s).',
      folderPartial:
        '{count} carpeta(s) adjunta(s) contienen demasiados archivos y solo se ha incluido una parte.',
      noLocalSource: '{count} archivo(s) no tienen un archivo legible en este dispositivo.',
    },
    passphrase: {
      createTitle: 'Proteger la copia de seguridad',
      openTitle: 'Se requiere una frase de contraseña',
      createHint:
        'Una frase de contraseña cifra el archivo comprimido. Deja ambos campos vacíos para guardarlo sin cifrar.',
      openHint:
        'Este archivo de copia de seguridad está cifrado. Introduce la frase de contraseña que se utilizó al crearlo.',
      label: 'Frase de contraseña',
      repeatLabel: 'Repetir frase de contraseña',
      placeholder: 'Dejar vacío para no cifrar',
      openBtn: 'Abrir',
      show: 'Mostrar frase de contraseña',
      hide: 'Ocultar frase de contraseña',
      wrong: 'Esta frase de contraseña no permite abrir este archivo.',
      mismatch: 'Las dos frases de contraseña no coinciden.',
      tooShort: 'La frase de contraseña debe tener al menos {count} caracteres.',
      noRecovery: 'No se puede recuperar una frase de contraseña olvidada: el archivo seguirá siendo ilegible.',
      optional:
        'Sin una frase de contraseña, la privacidad del archivo depende únicamente del lugar donde lo guardes.',
    },
    // Shown by the platform's file dialogs in their file-type dropdown, so it
    // reaches the user like any other label. One key for both of them.
    zipFilterName: 'ZIP Archive',
    create: {
      dialogTitle: 'Creando copia de seguridad',
      noticesTitle: 'Contenido del archivo de copia de seguridad',
      noticesBtn: 'Continuar',
      fileDialogTitle: 'Guardar copia de seguridad',
      fileDialogBtn: 'Guardar',
      text: {
        scanning: 'Leyendo los chats',
        readingAttachments: 'Leyendo archivo {number} de {total}',
        compressing: 'Comprimiendo {number} de {total}',
        encrypting: 'Cifrando el archivo de copia de seguridad',
        saving: 'Guardando el archivo de copia de seguridad',
      },
      // Permanent explanations rather than warnings to confirm: they are not
      // about the risk of this action but about the boundary of what an archive
      // can ever bring back - said now, rather than in half a year when the
      // archive is needed.
      attachmentsNotice:
        'Los archivos de los mensajes que recibiste se conservan en tu buzón del servidor y no se incluyen en el archivo de copia de seguridad. Los mensajes se restauran íntegramente.',
      thisDeviceNotice:
        'Solo se incluyen en la copia de seguridad los archivos que están en este dispositivo. Los mensajes cuyos archivos se adjuntaron desde otro de tus dispositivos se guardan sin esos archivos. Por tanto, realiza la copia de seguridad en el dispositivo donde se encuentran los archivos.',
      bigFilesNotice:
        'Los archivos de más de 20 MiB se adjuntan mediante referencias en lugar de copiarse, por lo que el archivo de copia de seguridad apunta a tus propios archivos en vez de contenerlos.',
      autoDeleteNotice:
        'Los chats con la eliminación automática activada solo restaurarán los mensajes cuyo plazo de conservación aún no haya vencido.',
      success: 'La copia de seguridad {filename} se ha guardado.',
      skippedTitle: 'Algunos archivos no se incluyeron en el archivo de copia de seguridad.',
      empty: 'No hay nada que guardar en la copia de seguridad.',
      cancel: 'Se ha interrumpido la creación de la copia de seguridad.',
      error: 'No se pudo crear la copia de seguridad.',
      errorTooLarge:
        'Este historial es demasiado grande para incluirlo íntegramente en un archivo de copia de seguridad. Crea una copia de seguridad sin archivos adjuntos.',
    },
    restore: {
      dialogTitle: 'Restaurando copia de seguridad',
      fileDialogTitle: 'Seleccionar archivo de copia de seguridad',
      fileDialogBtn: 'Abrir',
      confirmTitle: 'Restaurar desde una copia de seguridad',
      confirmBtn: 'Restaurar',
      confirmWarningText:
        'Este archivo se creó con la versión {archiveVersion}, mientras que esta aplicación utiliza la versión ' +
        '{appVersion}, o bien el archivo no contiene información sobre su versión. Restaurarlo podría dañar los ' +
        'chats. Continúa bajo tu propia responsabilidad.',
      unknownVersion: 'desconocida',
      unknownDate: 'desconocida',
      skippedTitle: 'Este archivo de copia de seguridad no contiene todos los archivos:',
      summary: {
        createdAt: 'Fecha de la copia de seguridad',
        chats: 'Chats en el archivo',
        messages: 'Mensajes en el archivo',
        attachments: 'Archivos en el archivo',
        currentChats: 'Chats actuales',
        toCreate: 'Se añadirían',
        toUpdate: 'Se actualizarían',
        toDelete: 'Se eliminarían',
        expiredSkipped: 'Omitidos por haber superado su plazo de eliminación automática',
      },
      mode: {
        mergeTitle: 'Añadir lo que falta',
        mergeHint:
          'Se restaurarán los chats y mensajes que no estén aquí. Nada de lo que ya existe se modificará ' +
          'ni se eliminará. Un mensaje eliminado después de crear la copia de seguridad seguirá eliminado.',
        replaceTitle: 'Hacer que los chats coincidan con el archivo',
        replaceHint:
          'El archivo determina cómo deben quedar los chats. Cualquier cambio que hayas realizado después ' +
          'de crear la copia de seguridad tendrá prioridad sobre su contenido.',
        replaceWarning:
          'Los chats y mensajes que no estén en el archivo y sean anteriores a él se eliminarán, ' +
          'tanto de este dispositivo como de los demás. Al eliminar un chat, se elimina todo su historial.',
      },
      devicesNotice:
        'La opción que elijas aquí se aplicará en todos tus dispositivos: la restauración se enviará a cada uno de ellos y se aplicará siguiendo la misma regla.',
      text: {
        unpacking: 'Leyendo el archivo',
        decrypting: 'Descifrando el archivo',
        storingAttachments: 'Guardando el archivo {number} de {total}',
        listingInbox: 'Comprobando qué mensajes siguen en el servidor',
        restoring: 'Restaurando {number} de {total}',
        announcing: 'Notificando a tus otros dispositivos',
        completed: 'Restauración completada',
      },
      success: 'Copia de seguridad restaurada: {created} añadidos, {updated} actualizados, {deleted} eliminados.',
      expiredNotice: 'Se omitieron {count} mensaje(s) porque ha vencido su plazo de eliminación automática.',
      offlineNotice:
        'No se pudo conectar con el servidor, por lo que se desconoce qué mensajes recibidos siguen allí. Es posible que algunos archivos no estén disponibles.',
      error: 'No se pudo restaurar la copia de seguridad.',
      errorCorruptedArchive: 'Este archivo está dañado o no es un archivo ZIP.',
      errorForeignArchive: 'Este archivo es una copia de seguridad de otra aplicación, no de los chats.',
      errorNoChats: 'Este archivo no contiene chats. Puede ser una copia de seguridad de otra aplicación.',
      errorUnreadableRecords: 'No se pueden leer los registros de este archivo.',
      errorPassphraseRequired: 'Este archivo está cifrado y requiere su frase de contraseña.',
      errorEncryptionUnsupported: 'Este archivo está cifrado, pero esta aplicación no puede descifrarlo aquí.',
    },
  },

  chat: {
    months: 'meses',
    days: 'días',
    hours: 'horas',
    minutes: 'minutos',
    seconds: 'segundos',
    total: 'Total',
    creating: {
      attachments: {
        remove: {
          all: 'Eliminar todos los archivos adjuntos',
        },
      },
    },
    attachment: {
      dialog: {
        title: 'Adjuntar archivos',
        btn: {
          select: 'Seleccionar',
        },
      },
      too_big: {
        error: 'El archivo {fileName} supera el límite de {limit} y no se puede adjuntar',
      },
      external_draft: {
        error: 'Error al adjuntar archivos enviados desde otra aplicación',
      },
      import_contacts: {
        title: 'Archivo de exportación de contactos',
        count: '{n} contacto | {n} contactos',
        save_tooltip: 'Guardar el archivo',
        tooltip: 'Importar contactos',
        error: 'No se pudieron transferir los contactos a la aplicación Contactos',
      },
      attaching: {
        error: 'Error al adjuntar el archivo {fileName}',
      },
    },
    recording: {
      dialogTitle: 'Grabar un mensaje',
      label: {
        voice: 'Mensaje de voz',
        video: 'Mensaje de vídeo',
      },
      limit: {
        voice: '15 minutos',
        video: '10 minutos',
      },
      hint: {
        choose:
          'Graba directamente en el chat. Elige qué quieres grabar: ' +
          'el dispositivo solo se activa cuando tú lo decides.',
        sent_at_once:
          'La grabación se envía como un mensaje independiente: puedes escucharla ' +
          'primero y no se modifica nada de lo que hayas escrito.',
        preparing: 'Activando el dispositivo…',
        recording:
          'Grabando. Pulsa Detener cuando hayas terminado; la grabación también se detiene automáticamente al alcanzar el límite.',
        review: 'Escucha la grabación y luego envíala o vuelve a grabarla.',
        tap_to_unmute: 'Reproduciendo sin sonido. Toca de nuevo para activar el sonido.',
      },
      note: {
        limit: 'hasta {limit}',
        no_microphone: 'No se ha encontrado ningún micrófono',
        no_camera: 'No se ha encontrado ninguna cámara',
      },
      btn: {
        cancel: 'Cancelar',
        stop: 'Detener',
        send: 'Enviar',
        rerecord: 'Grabar de nuevo',
      },
      stopped: {
        duration: 'La grabación alcanzó su límite de tiempo y se detuvo.',
        size:
          'La grabación alcanzó su límite de tamaño y se detuvo para que pueda reproducirse ' +
          'sin necesidad de descargarla por completo primero.',
      },
      error: {
        access_denied:
          'No se permite el acceso al micrófono o a la cámara. ' +
          'Permítelo en la configuración del sistema e inténtalo de nuevo.',
        no_device: 'No se encontró ningún micrófono ni cámara en este dispositivo.',
        device_busy:
          'El micrófono o la cámara están siendo utilizados por otra aplicación. ' +
          'Lo más habitual es que haya una llamada en curso.',
        unsupported: 'La grabación no es compatible con este entorno de ejecución.',
        failed: 'La grabación ha fallado.',
        sending: 'No se pudo enviar la grabación.',
      },
      tooltip: {
        record: 'Grabar un mensaje de voz o vídeo',
      },
    },
    action: {
      menu: {
        txt: {
          info: 'Información del chat',
          refresh: 'Forzar actualización del chat',
          rename: 'Cambiar nombre del chat',
          history: {
            export: 'Exportar historial',
            clean: 'Borrar historial',
          },
          close: 'Cerrar chat',
          timer: {
            label: 'Eliminación automática de mensajes',
            '0': 'Desactivado',
            '1': '1 año',
            '2': '1 mes',
            '3': '1 semana',
            '4': '1 día',
            '5': '1 hora',
          },
          block: 'Bloquear usuario',
          unblock: 'Desbloquear usuario',
          manage_blocks: 'Gestionar bloqueos',
          leave: 'Salir y eliminar el chat',
        },
      },
    },
    create: {
      dialog: {
        title: 'Crear nuevo',
        selected: {
          contacts: 'Miembros seleccionados',
        },
      },
      group: {
        name: {
          label: 'Nombre del grupo',
        },
      },
    },
    contact: {
      add: {
        btn: 'Añadir {addr}',
        error: {
          exists: 'El contacto {addr} ya existe',
          check_failed: '{addr} es una dirección desconocida o no existe en el dominio',
          unknown: 'No se pudo añadir el contacto {addr}',
        },
      },
      notification: {
        blocked: {
          part1: 'Has bloqueado a {name}.',
          part2: 'Ya no puede enviarte mensajes ni llamarte a través de PrivacySafe.',
        },
        unblocked: 'Has desbloqueado a {name}.',
      },
      blocked: {
        mark: 'Bloqueado. Desbloquea este contacto para iniciar un chat con él.',
        inChat: 'Bloqueado. Desmárcalo para eliminarlo del chat.',
      },
      error: {
        block: 'No se pudo bloquear el contacto',
        unblock: 'No se pudo desbloquear el contacto',
      },
    },
    content: {
      empty: 'Selecciona un chat para empezar a enviar mensajes',
    },
    list: {
      empty: 'Todavía no hay chats',
      item: {
        created_at: 'creado el {date}',
      },
    },
    call: {
      startFailed:
        'No se pudo conectar con el servicio en segundo plano para iniciar la llamada. ' +
        'Inténtalo de nuevo; si el problema persiste, reinicia la aplicación.',
      endFailed:
        'No se pudo conectar con el servicio en segundo plano para finalizar la llamada. ' +
        'Es posible que el estado de la llamada que se muestra aquí no esté actualizado; reinicia la aplicación si el problema persiste.',
    },
    header: {
      info: 'Última publicación el {date}',
      call: {
        duration: 'Duración de la llamada',
      },
      btn: {
        actions: 'Acciones',
      },
    },
    dialog: {
      manage_blocks: {
        title: 'Gestionar bloqueos',
        nobody: 'Ningún miembro coincide con la búsqueda',
      },
      info: {
        title: 'Información del chat',
        auto_delete: {
          off: 'La eliminación automática de mensajes está DESACTIVADA',
          txt: 'Los mensajes de este chat se eliminarán automáticamente después de {period} desde la fecha de envío o recepción',
        },
        users: 'Usuarios',
        search_placeholder: 'Nombre de usuario',
        btn: {
          edit_members: 'Editar lista de usuarios',
          back: 'Atrás',
          close: 'Cerrar',
          update: 'Actualizar',
        },
        user: {
          pending: 'Pendiente',
          admin: 'Administrador',
        },
      },
      clean_history: {
        title: 'Borrar el historial del chat',
      },
      export: {
        title: 'Exportar el historial del chat',
      },
      rename: {
        title: 'Cambiar el nombre del chat',
        input_placeholder: 'Introduce el nombre del chat',
        btn: 'Cambiar nombre',
      },
      delete: {
        title: 'Eliminar chat',
        btn: 'Eliminar',
        text: '¿Eliminar el chat {chatName}?',
      },
    },
    info: {
      user: {
        menu: {
          make_admin: 'Convertir en administrador',
          remove_admin: 'Quitar como administrador',
        },
      },
    },
    app_message: {
      success: {
        export: 'El archivo {file} se ha guardado.',
      },
      error: {
        export: 'Error al guardar el archivo {file}.',
        members_update: 'Error al editar la lista de miembros del chat',
        search: 'Error al buscar mensajes en el chat.',
        create_oto_chat: 'Error al crear un chat individual.',
        create_group_chat: 'Error al crear un chat grupal.',
        // The chat is the one open in front of the user, so these name the
        // person and not the chat: its id said nothing to anybody.
        already_admin: '{user} ya es administrador de este chat',
        already_not_admin: '{user} no es administrador de este chat',
        only_admin:
          '{user} es el único administrador de este chat y no se le puede quitar el rol de administrador',
      },
    },
    notification: {
      noNewMessages: 'No hay mensajes nuevos',
      callActive: {
        title: 'Llamada activa',
        message: 'Hay una llamada en curso en {chatName}. Toca para unirte.',
      },
      callEndedByHost: {
        title: 'Llamada finalizada',
        message: 'La persona que inició la llamada la ha finalizado en {chatName}.',
      },
      callAnsweredElsewhere: {
        message: 'Has respondido a esta llamada desde otro de tus dispositivos.',
      },
      callCollision: {
        joining: '{name} te ha llamado al mismo tiempo que tú. Te estás uniendo a su llamada.',
        unresolved:
          '{name} te estaba llamando al mismo tiempo y las dos llamadas no se conectaron. Intenta llamar de nuevo.',
      },
    },
    message: {
      dialog: {
        delete: {
          title: 'Eliminar mensaje',
          text: '¿Eliminar el mensaje seleccionado?',
          additional_text: '¿Eliminar para todos?',
        },
        forward: {
          title: 'Reenviar mensaje',
          section: {
            chats: {
              title: 'Chats',
              empty: 'No hay chats disponibles para seleccionar',
            },
          },
        },
        attachments_download: {
          title: 'Seleccionar una carpeta para descargar los archivos',
        },
        file_download: {
          title: 'Guardar el archivo',
        },
        folder_download: {
          title: 'Guardar la carpeta',
        },
      },
      input: {
        placeholder: {
          one_to_one: 'Escribe un mensaje...',
          group: 'Escribe un mensaje al grupo...',
        },
      },
      menu: {
        reaction: 'Reaccionar',
        reply: 'Responder',
        copy: 'Copiar',
        forward: 'Reenviar',
        edit: 'Editar',
        download: 'Descargar',
        resend: 'Volver a enviar',
        select: 'Seleccionar',
        info: 'Información',
        delete_message: 'Eliminar',
        cancel_sending: 'Cancelar envío',
      },
      label: {
        forward: 'Reenviado de',
        edit: 'Editar mensaje:',
        unread: 'Mensajes sin leer: {messages}',
        changed: 'editado',
        sending_from_other_device: 'Enviando desde otro dispositivo...',
      },
      reactions_dialog: {
        recent: 'Recientes:',
        icons: 'Iconos:',
        remove: 'Eliminar reacción',
        more: 'Más',
        less: 'Menos',
      },
      info_panel: {
        back: 'Volver a la lista de mensajes',
      },
      forward: {
        warning: {
          no_attachments: 'Los archivos adjuntos no se reenviarán: el mensaje original está en otro dispositivo',
        },
      },
      attachment: {
        not_available_on_this_device:
          'El archivo adjunto solo está disponible en el dispositivo desde el que se envió',
        only_on_sending_device: 'Los archivos solo están disponibles en el dispositivo desde el que se enviaron',
        make_preview: 'Mostrar vista previa',
      },
      action_message: {
        success: {
          clipboard_copy: 'El contenido del mensaje se ha copiado al portapapeles',
          file_download: 'Los archivos y las carpetas se han guardado correctamente',
        },
        error: {
          delete: 'Se ha producido un error al eliminar el mensaje seleccionado',
          file_notfound: 'Es posible que el archivo se haya eliminado o movido',
          file_download: 'Es posible que los archivos o las carpetas descargados se hayan eliminado o movido',
          original_not_reachable: 'El mensaje original está demasiado atrás en el historial o ha sido eliminado',
        },
      },
      btn: {
        open: {
          file: 'Abrir archivo',
          folder: 'Abrir carpeta',
        },
      },
      info: {
        autodelete_off: 'Este mensaje no se eliminará automáticamente',
        removeAfter: 'Este mensaje se eliminará automáticamente en {period}',
        removeAfter_mobile: 'Queda {period} para que este mensaje se elimine automáticamente',
        since: 'desde',
        between: 'de {from} a {to}',
        section: {
          text: 'Texto',
          reactions: 'Reacciones',
          errors: 'Errores',
        },
        label: {
          now: 'Ahora',
          history: 'Historial',
          state: 'estado',
        },
        text: {
          no_changes: 'No hay cambios',
          no_body: 'El mensaje no contiene texto',
          no_reactions: 'El mensaje no contiene reacciones',
          no_errors: 'El mensaje no contiene errores',
        },
        error: {
          unknownRecipient: 'destinatario desconocido',
          msgTooBig: 'este mensaje supera el tamaño permitido',
          inboxIsFull: 'el buzón de este destinatario está lleno',
          domainNotFound: 'no se encuentra este dominio',
          noServiceRecord: 'este dominio no admite 3N',
          recipientPubKeyFailsValidation: 'la clave pública no es válida',
          connectError: 'no se puede conectar',
          noDescription: 'Sin descripción',
        },
      },
    },
    messages: {
      selected: 'Seleccionados',
      bulk: {
        delete: 'Eliminar los mensajes seleccionados',
        exit: 'Salir del modo de acciones masivas',
      },
      info_message: {
        autodelete: {
          set_you: 'Has establecido el temporizador de eliminación automática de mensajes en {value}',
          set_user: '{user} ha establecido el temporizador de eliminación automática de mensajes en {value}',
          unset_you: 'Has desactivado el temporizador de eliminación automática de mensajes',
          unset_user: '{user} ha desactivado el temporizador de eliminación automática de mensajes',
        },
      },
    },
    system_message: {
      rename_chat: 'El chat ha sido renombrado por',
      member_left: '{member} ha abandonado este chat',
      you_are_removed: '{admin} te ha eliminado de este chat',
      chat_deleted: '{admin} ha eliminado este chat',
      add_members:
        '{admin} ha añadido a {membersToAdd} a este chat, con un total de {participantsNum} participantes',
      add_admins: '{admin} ha añadido a {adminsToAdd} como administradores de este chat',
      remove_members:
        '{admin} ha eliminado a {membersToDelete} de este chat, con un total de {participantsNum} participantes',
      remove_me: '{admin} me ha eliminado de este chat',
      remove_admins: '{admin} ha eliminado a {adminsToDelete} de los administradores de este chat',
      add_and_remove_members:
        '{admin} ha eliminado a {membersToDelete} de este chat y ha añadido a {membersToAdd}, con un total de {participantsNum} participantes',
      add_and_remove_admins:
        '{admin} ha eliminado a {adminsToDelete} de los administradores de este chat y ha añadido a {adminsToAdd}',
    },
    invitation: {
      btn: {
        deny: 'Rechazar',
        accept: 'Aceptar',
      },
      message: {
        oto: {
          incoming: 'El remitente con la dirección {sender} te invita a unirte al chat.',
          accepted: 'El remitente con la dirección {sender} te ha invitado a unirte al chat.',
          incoming_from_unknown: 'Un remitente desconocido con la dirección {sender} te invita a unirte al chat.',
          accepted_from_unknown:
            'Un remitente desconocido con la dirección {sender} te ha invitado a unirte al chat.',
          sent: 'Has iniciado este chat individual. Podrás enviar mensajes cuando la otra persona acepte la invitación.',
        },
        group: {
          incoming: 'El remitente con la dirección {sender} te invita a unirte a este chat grupal.',
          accepted: 'El remitente con la dirección {sender} te ha invitado a unirte a este chat grupal.',
          incoming_from_unknown:
            'Un remitente desconocido con la dirección {sender} te invita a unirte a este chat grupal.',
          accepted_from_unknown:
            'Un remitente desconocido con la dirección {sender} te ha invitado a unirte a este chat grupal.',
          sent: 'Has invitado a {members} a este chat grupal. Podrás enviar mensajes cuando al menos uno de los participantes acepte la invitación.',
        },
        default: {
          accepted: '{name} ha aceptado la invitación para unirse al chat.',
          sent: 'Has aceptado la invitación para unirte a este chat.',
        },
      },
      tooltip: {
        oto: {
          incoming_from_unknown: 'Al hacer clic en la dirección {address}, la añadirás a tu lista de contactos',
        },
      },
    },
    viewer: {
      btn: {
        download: 'Descargar archivo',
        exit: 'Salir de la vista',
        cancel_loading: 'Cancelar',
        pdf: {
          prev: 'Página anterior',
          next: 'Página siguiente',
        },
      },
      label: {
        page: 'Página',
        loading: '{done} de {total}',
      },
      error: {
        cannot_play: 'No se puede reproducir este archivo',
      },
      tooltip: {
        play: 'Reproducir',
        pause: 'Pausar',
        visual_setting: 'Configuración de visualización',
      },
      // Either side of the switch that picks how the sound is drawn.
      visualization: {
        mode1: 'Modo 1',
        mode2: 'Modo 2',
      },
    },
    search: {
      results: 'resultados',
    },
  },

  dialog: {
    button: {
      default: {
        cancel: 'Cancelar',
      },
      block: 'Bloquear',
      unblock: 'Desbloquear',
    },
    label: {
      warning: 'Advertencia',
    },
    text: {
      confirmation: '¿Estás seguro?',
      block: '¿Bloquear al usuario {mail}?',
      unblock: '¿Desbloquear al usuario {mail}?',
    },
    additionalText: {
      block: `Ya no podrán enviarte mensajes ni llamarte a través de PrivacySafe.<br>Los mensajes existentes permanecerán en esta conversación.`,
      unblock: 'Podrán volver a enviarte mensajes y llamarte a través de PrivacySafe.',
    },
    // The file-type name the platform's open-file dialog shows in its dropdown,
    // asked for by selectImageFilesWithDialog (image-files.ts).
    'open-file': {
      'image-type': 'Imágenes',
    },
  },

  validation: {
    text: {
      required: 'Este campo es obligatorio',
      length: 'No más de {length} caracteres',
      unknownRecipient: '{addr} es una dirección desconocida o no está presente en el dominio',
      inboxIsFull: 'El buzón de {addr} está lleno',
      senderNotAllowed: 'Acceso restringido a la dirección {addr}',
      recipientPubKeyFailsValidation: 'La clave pública de {addr} no es válida',
      serviceLocating: 'No hay ningún servicio para el dominio de {addr}',
      unknown: 'Error de red para la dirección {addr}',
    },
  },

  va: {
    btn: {
      end_call: 'Finalizar llamada',
      rejoin_call: 'Volver a unirse a la llamada',
    },
    text: {
      call_is_active: 'Hay una llamada activa. Toca para volver a unirte',
      call_in_progress: 'La llamada está en curso desde',
      incoming_call: 'Llamada entrante de {sender}',
      incoming_call_cancelled: 'La llamada entrante de {sender} fue cancelada',
      incoming_call_not_accepted: '{user} no ha aceptado la llamada actual',
      missed_incoming_call: 'Llamada perdida de {sender}',
      outgoing_call: 'Llamada saliente',
      outgoing_call_cancelled: 'La llamada saliente fue cancelada',
      outgoing_call_cancelled_by: 'La llamada saliente fue cancelada por {user}',
      call_collision_joining: '{user} te llamó al mismo tiempo. Uniéndote a su llamada.',
      call_collision_failed: 'La llamada con {user} no se realizó: ambos intentaron llamarse al mismo tiempo',
      user_left_call: '{user} abandonó la llamada',
      participants: 'Participantes',
      call_full: 'La llamada está llena ({current}/{max} participantes). Inténtalo de nuevo más tarde.',
      user_stopped_sharing: '[{user}] dejó de compartir "{screen}"',
      peer_app_closed: '{user} cerró la aplicación. La llamada finalizará en unos segundos.',
      host_unreachable:
        'Ya no se puede establecer conexión con {user}; parece que la llamada ha finalizado. La ventana de llamada se cerrará.',
      call_setup_timeout: 'No se pudo conectar con {user}. La ventana de llamada se cerrará.',
      invite_not_delivered: 'No se pudo entregar la invitación a {user}. No se ha iniciado ninguna llamada.',
      // The reason itself goes to the log: a JS error message is not something
      // to read in a notice.
      call_start_failed: 'No se pudo iniciar la llamada.',
      group_call_unanswered: 'Nadie se ha unido a la llamada. La ventana de llamada se cerrará.',
    },
    setup: {
      title: 'Configuración de llamada',
      notification: {
        no_cameras: 'No hay cámaras de vídeo disponibles',
        media_access_failed: 'No se pudo acceder a la cámara o al micrófono',
      },
      tooltip: {
        mute: 'Silenciar',
        unmute: 'Activar el sonido',
        camera_off: 'Apagar la cámara',
        camera_on: 'Encender la cámara',
        camera_select: 'Seleccionar cámara web',
      },
    },
    presettings: {
      incoming_call: 'Llamada entrante de {address}',
      call_already_over: 'La llamada ya ha finalizado',
      btn: {
        start: 'Iniciar llamada',
        join: 'Unirse',
        decline: 'Rechazar',
      },
    },
  },

  call: {
    text: {
      participant_invited: 'Llamando a {user}…',
      participant_connecting: '{user} se está conectando a la llamada…',
      participant_securing: 'Protegiendo la conexión con {user}…',
      participant_establishing: 'Estableciendo la conexión con {user}…',
      participant_reconnecting: 'Reconectando con {user}…',
      host: 'Anfitrión de la llamada',
      participant_no_response: '{user} no responde',
      participant_not_reached: 'No se pudo entregar la invitación a {user}',
      participant_declined: '{user} rechazó la llamada',
      participant_failed: 'No se pudo conectar con {user}',
      participant_disconnected: '{user} está desconectado',
      waiting_for_participants: 'Esperando a que se unan {count} participante(s) más…',
      stream_about_to_start: 'La transmisión de la cámara de {user} está a punto de comenzar…',
      tap_to_unmute: 'Toca para activar el sonido',
    },
    tooltip: {
      fullscreen_mode_enable: 'Activar el modo de pantalla completa',
      fullscreen_mode_disable: 'Desactivar el modo de pantalla completa',
      screenshare_mode_row: 'Cambiar al modo de vista horizontal',
      screenshare_mode_column: 'Cambiar al modo de vista vertical',
      mic_on: 'Activar el micrófono',
      mic_off: 'Desactivar el micrófono',
      camera_on: 'Encender la cámara',
      camera_off: 'Apagar la cámara',
      sharing_on: 'Abrir la configuración para compartir pantalla',
      participants_info: 'Información de los participantes de la llamada',
    },
    sharing: {
      title: 'Seleccionar para compartir',
      desktop_sound: 'Sonido del escritorio',
      settings: {
        sound_share: 'Compartir sonido',
        screens_title: 'Pantallas',
        windows_title: 'Ventanas',
      },
    },
  },
};
