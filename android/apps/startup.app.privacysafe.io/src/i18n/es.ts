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
  signin: {
    title: 'Iniciar sesión',
    btn: {
      login: 'Iniciar sesión',
      entering: 'Entrando ... {percent}%',
      make_account: 'Crear cuenta',
      scan_qr: 'Escanear código QR',
      or: 'O',
    },
    footer: {
      like_it: '¿Te gusta lo que hacemos?',
      support_us: 'Apóyanos',
    },
  },

  placeholder: {
    username: `Nombre de usuario`,
    enter_password: 'Contraseña',
    create_password: 'Contraseña',
    confirm_password: 'Confirmar contraseña',
  },

  autologin: {
    on: 'Inicio de sesión automático ACTIVADO',
    off: 'Inicio de sesión automático DESACTIVADO',
  },

  signup: {
    title: 'Crear nombre de usuario',
    choice: {
      status: {
        have_domains_without_token: 'Dominios de registro disponibles sin token',
        have_domains_with_token: 'Dominios disponibles con token',
        no_domains_without_token: 'No hay dominios. Es posible que necesites un token.',
        no_domains_with_token: 'No hay dominios. ¿El token es correcto?',
      },
      err: {
        no_connect: 'Error de conexión. ¿La URL es correcta?',
        non_ok_status: 'El servidor respondió de forma inesperada ({status}). ¿La URL es correcta?',
        general: 'Se ha producido un error. ¿La URL es correcta? ¿El dispositivo está conectado a Internet?',
      },
    },
    step: {
      count: 'Paso {num} de {total}: {text}',
      text1: 'Seleccionar proveedor',
      text2: 'Crear nombre de usuario',
      text3: 'Crear contraseña',
      text4: 'Información importante',

      btn: {
        next: 'Siguiente',
      },
      create_user: {
        username_length_txt: 'El nombre de usuario debe tener entre 6 y 60 caracteres.',
        username_chars_txt:
          'Usa letras latinas, números y algunos caracteres: - (guion), . (punto) o _ (guion bajo).',
        txt: 'El nombre de usuario debe tener entre 6 y 60 caracteres. Puedes usar letras, números y algunos caracteres: - (guion), . (punto) o _ (guion bajo). También puedes usar caracteres de cualquier idioma.',
        domain_label: 'Registrarse en el dominio',
        status: {
          addr_not_available: 'La dirección {address} no está disponible.',
        },
      },
      create_password: {
        pass_length_txt: 'La contraseña debe tener al menos 12 caracteres.',
        pass_chars_txt: 'Usa únicamente letras latinas, números y algunos caracteres: ',
        confirmation_txt: 'Las contraseñas deben coincidir.',
      },
      acknowledgments: {
        title: 'Confirmación importante',
        txt: {
          intro: 'Confirma lo siguiente:',
          check1: {
            p1: 'Confirmo que tengo 18 años o más.',
          },
          check2: {
            p1: 'Entiendo que no se puede recuperar una contraseña perdida.',
          },
          check3: {
            p1: 'Guardaré una copia de seguridad segura de mi contraseña, por ejemplo, una copia física almacenada bajo llave.',
          },
        },
        btn: 'Crear cuenta',
      },
      progress: {
        txt: 'Preparando tu zona segura...',
        key_generation_txt: 'Preparando tu clave...',
      },
    },
    provider: {
      stepTitle: 'Elige tu identidad',
      silver: {
        title: 'Plata',
        info: '{type} {domain}',
        type: 'GRATIS',
      },
      gold: {
        title: 'Oro',
        info: '{type} {domain}',
        type: 'PRO',
      },
      platinum: {
        title: 'Platino',
        info: '{type} {domain}',
        type: 'VIP',
      },
      custom_link: {
        input_placeholder: 'Token o enlace de cuenta',
        account_help: 'Ayuda de cuenta',
      },
      existing_signup_link: '¿Ya te has registrado?',
      footer_info_link_txt: 'Aloja tu propio dominio',
    },
  },

  'boot-screen': {
    txt: 'Preparando tu zona segura...',
    logs: {
      summary: 'Mensajes de inicio del sistema:',
      btn_show: 'Ver mensajes de inicio del sistema',
      btn_hide: 'Ocultar mensajes de inicio del sistema',
    },
  },

  err: {
    domain_not_found: 'No se encuentra el dominio {domain}. ¿Lo has escrito correctamente?',
    domain_has_no_srv: 'El dominio {domain} no tiene ningún servicio. ¿Lo has escrito correctamente?',
    incorrect_password: 'Contraseña incorrecta. Inténtalo de nuevo.',
    login_not_recognized: 'No se reconoce el inicio de sesión {login}. ¿Lo has escrito correctamente?',
    incorrect_login: 'Nombre de usuario incorrecto.',
    field_required: 'El campo no puede estar vacío. ',
    login_length: 'El nombre de usuario debe contener entre 6 y 60 letras, números y caracteres permitidos. ',
    login_characters: 'El nombre de usuario contiene caracteres no permitidos. ',
    password_length: 'La contraseña debe contener al menos 12 caracteres. ',
    password_characters: 'La contraseña contiene caracteres no permitidos. ',
    confirmation_err: 'La contraseña no coincide con la introducida.',
    singup_available_err: `No se ha creado la cuenta. La dirección {address} ya no está disponible. Prueba con otra dirección.`,
    singup_general_err: `Vaya... Lo sentimos mucho, pero algo salió mal. Cierra la aplicación e intenta registrarte más tarde.`,
    sign_in: 'Error al iniciar sesión. Inténtalo de nuevo más tarde.',
    invalid_login: `El nombre de usuario debe contener el símbolo {'@'}. `,
  },
};
