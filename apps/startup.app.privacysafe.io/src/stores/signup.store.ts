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
import { ref } from 'vue';
import { defineStore } from 'pinia';
import i18n from '@/i18n';
import { defaultSignupURL } from '@/constants';
import { signupParamsToLink, SignupParamsViaURL } from '@/utils/signup-links';

interface SignupState {
  username: string;
  userDomain: string;
  address: string;
  password: string;
  isStandardService: boolean;
  srvToken: string;
  availableDomains: string[];
  keyGenerationProc: undefined | number;
  signupLink: string
}

export const useSignupStore = defineStore('signup', () => {
  const username = ref('');
  const userDomain = ref('');
  const address = ref('');
  const password = ref('');
  const isStandardService = ref(true);
  const srvToken = ref('');
  const availableDomains = ref<string[]>([]);
  const keyGenerationProc = ref<undefined | number>(undefined);
  const signupLink = ref('');

  async function getDomainsFor(params: SignupParamsViaURL): Promise<{
    domains?: string[];
    errMsgLabel?: string;
    okMsgLabel?: string;
  }> {
    const { signupUrl, token, isStandardService } = params || {};
    if (isStandardService) {
      await w3n.signUp.setSignUpServer(defaultSignupURL);
    } else {
      await w3n.signUp.setSignUpServer(signupUrl);
    }

    try {
      const domains = await w3n.signUp.getAvailableDomains(token);
      if (domains.length > 0) {
        return {
          domains,
          okMsgLabel: token
            ? i18n.global.t('signup.choice.status.have_domains_with_token')
            : i18n.global.t('signup.choice.status.have_domains_without_token'),
        };
      }

      return {
        errMsgLabel: token
          ? i18n.global.t('signup.choice.status.no_domains_with_token')
          : i18n.global.t('signup.choice.status.no_domains_without_token'),
      };
    } catch (exc) {
      if ((exc as web3n.HTTPException).type === 'http-request') {
        return {
          errMsgLabel: i18n.global.t('signup.choice.err.non_ok_status', {
            status: `${(exc as web3n.HTTPException).status}`,
          }),
        };
      }

      if ((exc as web3n.ConnectException).type === 'http-connect') {
        return {
          errMsgLabel: i18n.global.t('signup.choice.err.no_connect'),
        };
      }

      return {
        errMsgLabel: i18n.global.t('signup.choice.err.general'),
      };
    }
  }

  async function checkSignupParamsAndSetDomains(params: SignupParamsViaURL): Promise<boolean> {
    const { domains } = await getDomainsFor(params);
    if (domains) {
      const { isStandardService: isStdSrv, token } = params;
      srvToken.value = token ?? '';
      isStandardService.value = !!isStdSrv;
      availableDomains.value = domains;
      signupLink.value = signupParamsToLink(params);
      return true;
    }

    return false;
  }

  async function initStandard(): Promise<void> {
    isStandardService.value = true;
    signupLink.value = '';
    srvToken.value = '';
    const { domains } = await getDomainsFor({ signupUrl: '', isStandardService: true, token: undefined });
    availableDomains.value = domains ?? [];
  }

  function setStoreFieldValue(field: keyof SignupState, value: SignupState[keyof SignupState]): void {
    // eslint-disable-next-line default-case
    switch (field) {
      case 'username':
        username.value = value as SignupState['username'];
        break;
      case 'userDomain':
        userDomain.value = value as SignupState['userDomain'];
        break;
      case 'address':
        address.value = value as SignupState['address'];
        break;
      case 'password':
        password.value = value as SignupState['password'];
        break;
      case 'isStandardService':
        isStandardService.value = value as SignupState['isStandardService'];
        break;
      case 'srvToken':
        srvToken.value = value as SignupState['srvToken'];
        break;
      case 'availableDomains':
        availableDomains.value = value as SignupState['availableDomains'];
        break;
      case 'keyGenerationProc':
        keyGenerationProc.value = value as SignupState['keyGenerationProc'];
        break;
      case 'signupLink':
        signupLink.value = value as SignupState['signupLink'];
        break;
    }
  }

  return {
    username,
    userDomain,
    address,
    password,
    isStandardService,
    srvToken,
    availableDomains,
    keyGenerationProc,
    signupLink,
    setStoreFieldValue,
    getDomainsFor,
    checkSignupParamsAndSetDomains,
    initStandard,
  };
});
