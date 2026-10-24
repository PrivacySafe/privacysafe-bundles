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
  signin: {
    title: 'Sign In',
    btn: {
      login: 'Log In',
      entering: 'Entering ... {percent}%',
      make_account: 'Create Account',
      scan_qr: 'Scan QR',
      or: 'OR',
    },
    footer: {
      like_it: 'Like what we do?',
      support_us: 'Support Us',
    },
  },

  placeholder: {
    username: `Username`,
    enter_password: 'Password',
    create_password: 'Password',
    confirm_password: 'Confirm Password',
  },

  autologin: {
    on: 'Auto Login ON',
    off: 'Auto Login OFF',
  },

  signup: {
    title: 'Create Username',
    choice: {
      status: {
        have_domains_without_token: 'Signup domains available without token',
        have_domains_with_token: 'Domains available with token',
        no_domains_without_token: 'No domains. May need token.',
        no_domains_with_token: 'No domains. Is token correct?',
      },
      err: {
        no_connect: 'Fail to connect. Is url correct?',
        non_ok_status: 'Server replies funny ({status}). Is url correct?',
        general: 'Error occurred. Is url correct? Is device online?',
      },
    },
    step: {
      count: 'Step {num} of {total}: {text}',
      text1: 'Select Provider',
      text2: 'Create Username',
      text3: 'Create Password',
      text4: 'Important Information',

      btn: {
        next: 'Next',
      },
      create_user: {
        username_length_txt: 'Username should be 6 upto 60 characters long.',
        username_chars_txt:
          'Use latin letters, numbers and some characters: - (hyphen), . (dot) or _ (underscore).',
        txt: 'Username should be 6 upto 60 characters. You can use letters, numbers and some characters: - (hyphen), . (dot) or _ (underscore). You can use characters from any language.',
        domain_label: 'Register to domain',
        status: {
          addr_not_available: 'Address {address} is not available.',
        },
      },
      create_password: {
        pass_length_txt: 'Password should be at least 12 characters long.',
        pass_chars_txt: 'Use only latin letters, numbers and some characters: ',
        confirmation_txt: 'Passwords should match.',
      },
      acknowledgments: {
        title: 'Important Acknowledgment',
        txt: {
          intro: 'Please acknowledge the following:',
          check1: {
            p1: 'I confirm that I am 18 years of age or older.',
          },
          check2: {
            p1: 'I understand that a lost password cannot be recovered.',
          },
          check3: {
            p1: 'I will keep a secure backup of my password, such as a physical copy in locked storage.',
          },
        },
        btn: 'Create Account',
      },
      progress: {
        txt: 'Preparing Your Secure Zone...',
        key_generation_txt: 'Preparing Your Key...',
      },
    },
    provider: {
      stepTitle: 'Choose Your Identity',
      silver: {
        title: 'Silver',
        info: '{type} {domain}',
        type: 'FREE',
      },
      gold: {
        title: 'Gold',
        info: '{type} {domain}',
        type: 'PRO',
      },
      platinum: {
        title: 'Platinum',
        info: '{type} {domain}',
        type: 'VIP',
      },
      custom_link: {
        input_placeholder: 'Token or Account Link',
        account_help: 'Account Help',
      },
      existing_signup_link: 'Already Signed Up?',
      footer_info_link_txt: 'Host Your Own Domain',
    },
  },

  'boot-screen': {
    txt: 'Preparing Your Secure Zone...',
    logs: {
      summary: 'System boot messages:',
      btn_show: 'View system boot messages',
      btn_hide: 'Hide system boot messages',
    },
  },

  err: {
    domain_not_found: 'Domain {domain} is not found. Is it entered correctly?',
    domain_has_no_srv: 'Domain {domain} has no service. Is it entered correctly?',
    incorrect_password: 'Incorrect password. Try again.',
    login_not_recognized: 'Login {login} is not recognized. Is it entered correctly?',
    incorrect_login: 'Incorrect login.',
    field_required: 'The field cannot be empty. ',
    login_length: 'Login must contain from 6 to 60 letters, numbers and allowed characters. ',
    login_characters: 'The login contains prohibited characters. ',
    password_length: 'Password must contain at least 12 characters. ',
    password_characters: 'The password contains prohibited characters. ',
    confirmation_err: 'Does not match the password entered.',
    singup_available_err: `Account wasn't created. Address {address} is no longer available. Try for another address`,
    singup_general_err: `Oops... We're so sorry, but something went wrong. Please close the app and try signup later.`,
    sign_in: 'SignIn error. Please try again later.',
    invalid_login: `The login must contain the {'@'} symbol. `,
  },
};
