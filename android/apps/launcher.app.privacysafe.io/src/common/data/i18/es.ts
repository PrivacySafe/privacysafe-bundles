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
import type { MessageSchema } from './en';

export const es: MessageSchema = {
  app: {
    title: 'Panel',
    version: 'v {version}',
    status: {
      label: 'estado',
      online: 'en línea',
      offline: 'desconectado',
    },
    user_menu: {
      logout: 'Cerrar sesión',
      add: 'Agregar cuenta',
      exit: 'Salida',
    },
    tabs: {
      applications: 'Mis aplicaciones',
      update: 'Tienda de aplicaciones',
    },
    action: {
      open: 'Abierto',
      update: 'Actualizar',
      install: 'Instalar',
      close_old_version: 'Cerrar versión anterior',
    },
    update: {
      search_placeholder: 'Buscar aplicación',
    },
    list: {
      empty: 'No se encontraron aplicaciones',
    },
    add: {
      tooltip: 'Añadir aplicación desde un archivo',
    },
    mobile: {
      menu: {
        my_apps: 'Mis aplicaciones',
        updates: 'Actualizaciones',
        store: 'Tienda de aplicaciones',
        settings: 'Ajustes',
      },
    },
    orientation: {
      rotateBack: 'Por favor, vuelve a colocar el teléfono en orientación vertical.',
    },
    info: {
      details: 'Detalles de la aplicación',
      publisher: 'Editor',
      website: 'Sitio web',
      contact: 'Contacto',
      policy: 'Política de privacidad',
      terms: 'Términos de servicio',
      license: 'Licencia',
      source: 'Código fuente',
    },
  },

  btn: {
    'check-update': 'Buscar actualizaciones',
    'checking-for-update': 'Buscando actualizaciones',
    'restart-platform': 'Reiniciar para actualizar',
  },

  version: {
    'to-update': 'Versión actual: {current}. Nueva versión: {update}',
    'to-install': 'Nueva versión: {install}',
  },

  settings: {
    title: 'ajustes',
    btn: {
      open: 'Abrir configuración',
      'custom-logo': {
        'add-logo': 'Añadir logotipo personalizado',
      },
    },
    section: {
      appearance: 'Apariencia',
    },
    system: 'Sistema',
    label: {
      autoupdates: 'Actualizaciones automáticas',
      on: 'Encendido',
      off: 'Apagado',
      yes: 'Sí',
      no: 'No',
      theme: 'Tema',
      language: 'Idioma',
      'custom-logo': 'Logotipo personalizado',
      showing_devtool: 'Mostrar herramientas de desarrollo',
      autologin: 'Inicio de sesión automático',
      autologin_enter_password: 'Introduce tu contraseña para habilitar el inicio de sesión automático.',
    },
    placeholder: {
      password: 'Contraseña',
    },
    messages: {
      autologin_set_success: 'El inicio de sesión automático está habilitado',
      autologin_password_wrong: `Contraseña incorrecta; no es posible habilitar el inicio de sesión automático.`,
      save_success: 'La configuración de la aplicación se ha guardado correctamente.',
      save_error: 'Error al guardar la configuración de la aplicación',
    },
    theme: {
      light: 'Ligero',
      midnight: 'Azul medianoche',
      dark: 'Oscuro',
    },
  },

  dialog: {
    'select-logo-file': {
      title: 'Seleccionar archivo con logotipo personalizado',
      btn: 'Seleccionar',
    },
    'open-file': {
      'image-type': 'Imágenes',
    },
    settings_dialog_autologin: {
      title: 'Habilitar inicio de sesión automático',
    },
  },

  install: {
    process: 'La instalación inicial de aplicaciones está en curso.',
    progress: '{installed} de {total} aplicaciones instaladas',
    unpacking: 'Desempaquetando {name}…',
    installing: 'Instalando {name}…',
  },

  update_check: {
    start: 'Buscando actualizaciones',
    in_progress: 'Búsqueda de actualizaciones en curso',
    updates_found: 'Se han encontrado {numOfUpdates} actualización(es)',
    no_updates: 'No se encontraron actualizaciones',
    messages: {
      error: {
        updates:
          'Error al determinar si es necesario actualizar las aplicaciones. Por favor, inténtalo de nuevo más tarde.',
      },
    },
  },

  platform: {
    title: 'PrivacySafe',
    description: 'Plataforma central necesaria para el funcionamiento de tus aplicaciones.',
    action_restart: 'Reiniciar para actualizar',
  },

  system: {
    init_setup_start:
      'Configuración del sistema durante el primer inicio con las aplicaciones incluidas {appsList}',
    init_setup_done: 'La configuración del sistema ha finalizado.',
    data_removal: {
      section: 'Eliminación de datos',
      wipe_from_device: 'Borrar los datos de este dispositivo',
    },
    map: {
      tooltip: 'Mapa del sistema',
      control: {
        zoom: 'Zoom',
        formFactor: {
          label: 'Factor de forma',
          desktop: 'de oficina',
          phone: 'teléfono',
        },
        direction: 'Dirección',
        sketch: 'Bosquejo',
      },
    },
  },
};
