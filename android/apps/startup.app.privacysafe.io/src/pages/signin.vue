<!--
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
-->
<script setup lang="ts">
  import { computed, inject, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useRouter } from 'vue-router';
  import { storeToRefs } from 'pinia';
  import { NOTIFICATIONS_KEY, type NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { Nullable, Ui3nButton, Ui3nInput, Ui3nRipple as vUi3nRipple, Ui3nSwitch } from '@v1nt1248/3nclient-lib';
  import { useLoggedInUserStore } from '@/stores/logged-in-user.store';
  import { APP_ROUTES } from '@/constants';
  import { areAddressesEqual, UserIdParseException } from '@/utils/canonical-address';
  import LoginSelector from '@/components/login-selector.vue';
  import prLogo from '@/assets/images/privacysafe-logo.svg';
  import StartupFooter from '@/components/startup-footer.vue';
  import { useAutologinsStore } from '@/stores/autologin.store';
import { useSignupStore } from '@/stores/signup.store';
import { parse3NWebURL } from '@/utils/signup-links';

  const { t } = useI18n();
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;
  const router = useRouter();

  const loggedInUserStore = useLoggedInUserStore();
  const { usersOnDisk } = storeToRefs(loggedInUserStore);
  const { setUserId } = loggedInUserStore;

  const autologinStore = useAutologinsStore();
  const { isAutologinAvailable } = autologinStore;
  const { autoLoginEnabled } = storeToRefs(autologinStore);
  // init value for signin flow
  autoLoginEnabled.value = true;

  const signupStore = useSignupStore();
  const { checkSignupParamsAndSetDomains } = signupStore;
  const { availableDomains } = storeToRefs(signupStore);

  const form = ref({
    login: {
      field: '',
      isTouched: false,
      errorMessage: '',
      isMenuOpen: false,
    },
    password: {
      field: '',
      isTouched: false,
      errorMessage: '',
    },
  });
  const doesPasswordShow = ref(false);

  const signInProgress = ref<Nullable<number>>(null);

  const isFormValid = computed(
    () =>
      form.value.login.isTouched &&
      form.value.password.isTouched &&
      !form.value.login.errorMessage &&
      !form.value.password.errorMessage,
  );

  const userIsDoingLogin = computed(() => !!form.value.password.field);

  const loginValidationRules = [
    (v: string) => !!v || t('err.field_required'),
    (v: string) => v.includes('@') || t('err.invalid_login'),
  ];
  const passwordValidationRules = [(v: string) => !!v || t('err.field_required')];

  function validate(field: 'login' | 'password', value: string): void {
    form.value[field].errorMessage = '';
    const rules = field === 'login' ? loginValidationRules : passwordValidationRules;
    for (const rule of rules) {
      const res = rule(value);
      if (typeof res === 'string') {
        form.value[field].errorMessage += res;
      }
    }
  }

  function onFieldUpdate(value: string, field: 'login' | 'password') {
    if (!form.value[field].isTouched) {
      form.value[field].isTouched = true;
    }

    validate(field, value);
  }

  function createNewAccount() {
    return router.push({ name: APP_ROUTES.SIGNUP, query: { step: 1 } });
  }

  function switchToPostLoginPage(userId: string) {
    setUserId(userId);
    return router.push({ name: APP_ROUTES.POSTLOGIN });
  }

  async function signIn() {
    if (!isFormValid.value) {
      return;
    }

    try {
      signInProgress.value = 0;
      const userExistOnDisk = usersOnDisk.value.find(u => areAddressesEqual(u, form.value.login.field));
      if (userExistOnDisk) {
        const storageOpened = await w3n.signIn.useExistingStorage(
          form.value.login.field,
          form.value.password.field,
          val => (signInProgress.value = val),
        );
        if (storageOpened) {
          return switchToPostLoginPage(form.value.login.field);
        }

        form.value.password.isTouched = false;
        form.value.password.field = '';
        form.value.password.errorMessage = t('err.incorrect_password');
        return;
      }

      const userExistsRemotely = await w3n.signIn.startLoginToRemoteStorage(form.value.login.field);
      if (!userExistsRemotely) {
        form.value.login.isTouched = false;
        form.value.login.errorMessage = t('err.login_not_recognized', { login: form.value.login.field });
        return;
      }

      const storageOpened = await w3n.signIn.completeLoginAndLocalSetup(
        form.value.password.field,
        val => (signInProgress.value = val),
      );
      if (storageOpened) {
        return switchToPostLoginPage(form.value.login.field);
      }
    } catch (err) {
      console.error(err);
      const indOfAt = form.value.login.field.indexOf('@');
      const domain = form.value.login.field.substring(indOfAt + 1);

      let errMsg = '';
      if ((err as UserIdParseException).type === 'user-id-parse') {
        errMsg = t('err.incorrect_login');
      } else if ((err as web3n.RuntimeException).cause) {
        const errCause = (err as web3n.RuntimeException).cause as web3n.ServLocException;
        if (errCause.type === 'service-locating') {
          if (errCause.domainNotFound) {
            errMsg = t('err.domain_not_found', { domain });
          } else if (errCause.noServiceRecord) {
            errMsg = t('err.domain_has_no_srv', { domain });
          }
        }
      }

      $createNotice({
        type: 'error',
        content: errMsg || t('err.sign_in'),
        duration: 4000,
      });
    } finally {
      signInProgress.value = null;
    }
  }

  const qrScanPossible = !!w3n.scanUrlQR;
  async function scanStartupUrlFromQR() {
    const scannedURL = await w3n.scanUrlQR!(['', '']);
    if (!scannedURL) {
      return;
    }
    const params = parse3NWebURL(scannedURL);
    if (!params) {
      return;
    }
    const haveSignupDomains = await checkSignupParamsAndSetDomains(params);
    if (haveSignupDomains) {
      router.push({
        name: APP_ROUTES.SIGNUP,
        query: {
          step: 2,
          domain: availableDomains.value[0]
        },
      });
    }
  }

  function openSupportUsBrowserPage() {
    w3n.provider.openInExternal(`https://psafe.ly/app-donate`);
  }
</script>

<template>
  <section :class="$style.signin">
    <div :class="$style.logoBlock">
      <img
        :src="prLogo"
        alt="PrivacySafe logo"
      />
    </div>

    <div :class="$style.inputBlock">
      <div :class="$style.row">
        <login-selector
          v-model="form.login.field"
          :placeholder="t('placeholder.username')"
          :items="usersOnDisk"
          :display-state-mode="form.login.isTouched && form.login.errorMessage ? 'error' : undefined"
          :display-state-message="
            !form.login.isMenuOpen && form.login.isTouched && form.login.errorMessage
              ? form.login.errorMessage
              : ''
          "
          @open:menu="form.login.isMenuOpen = $event"
          @update:model-value="ev => onFieldUpdate(ev, 'login')"
        />
      </div>

      <div :class="$style.row">
        <ui3n-input
          v-model="form.password.field"
          :type="doesPasswordShow ? 'text' : 'password'"
          :placeholder="t('placeholder.enter_password')"
          :display-state-mode="form.password.isTouched && form.password.errorMessage ? 'error' : undefined"
          :display-state-message="
            form.password.isTouched && form.password.errorMessage ? form.password.errorMessage : ''
          "
          :class="$style.password"
          @update:model-value="ev => onFieldUpdate(ev, 'password')"
          @keyup.enter="signIn"
        />

        <ui3n-button
          v-if="form.password.field"
          type="icon"
          color="transparent"
          :icon="doesPasswordShow ? 'eye-off-outline' : 'eye-outline'"
          icon-size="20"
          icon-color="var(--color-icon-button-tritery-default)"
          :class="$style.showPasswordBtn"
          @click.stop.prevent="doesPasswordShow = !doesPasswordShow"
        />
      </div>
    </div>

    <div
      :class="$style.row"
      v-if="isAutologinAvailable && userIsDoingLogin"
    >
      <div :class="$style.autologin">
        <ui3n-switch
          v-model="autoLoginEnabled"
          size="24"
        />
        <span>{{ t(autoLoginEnabled ? 'autologin.on' : 'autologin.off') }}</span>
      </div>
    </div>

    <div :class="$style.btnsBlock">
      <div :class="$style.row">
        <div
          :class="[
            $style.bigBtnLayout,
            $style.siginInBtn,
            !!isFormValid && !signInProgress ? $style.siginInBtnEnabled : '',
          ]"
          @click="signIn"
        >
          {{
            signInProgress === null ? t('signin.btn.login') : t('signin.btn.entering', { percent: signInProgress })
          }}
        </div>
      </div>

      <div
        :class="$style.line"
        v-if="!userIsDoingLogin"
      >
        <span :class="$style.textInLine">{{ t('signin.btn.or') }}</span>
      </div>

      <div
        :class="$style.row"
        v-if="!userIsDoingLogin"
      >
        <div
          v-ui3n-ripple
          :class="[$style.bigBtnLayout, $style.createAccountBtn]"
          @click="createNewAccount"
        >
          {{ t('signin.btn.make_account') }}
        </div>
      </div>

      <div
        :class="$style.row"
        v-if="qrScanPossible && !userIsDoingLogin"
      >
        <div
          v-ui3n-ripple
          :class="$style.scanBtn"
          @click="scanStartupUrlFromQR"
        >
          {{ t('signin.btn.scan_qr') }}
        </div>
      </div>
    </div>

    <startup-footer>
      <div :class="$style.footer">
        <span :class="$style.heart">♥</span>
        <span>{{ t('signin.footer.like_it') }}</span>
        <ui3n-button
          :type="'tertiary'"
          @click="openSupportUsBrowserPage"
        >
          {{ t('signin.footer.support_us') }}
        </ui3n-button>
      </div>
    </startup-footer>
  </section>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins' as mixins;

  .signin {
    position: relative;
    width: 100%;
    min-height: calc(var(--spacing-xxl) * 10);
    padding-left: var(--spacing-ml);
    padding-right: var(--spacing-ml);
  }

  .logoBlock {
    padding-left: var(--spacing-xs);
    padding-right: var(--spacing-xs);
    width: 100%;
    img {
      width: 100%;
    }
    margin-top: calc(var(--spacing-xl) * 2);
  }

  .inputBlock {
    margin-top: var(--spacing-xl);
  }

  .btnsBlock {
    margin-top: var(--spacing-xl);
  }

  .row {
    position: relative;
    width: 100%;

    .showPasswordBtn {
      --btn-size: 28px;
      position: absolute;
      max-width: var(--btn-size) !important;
      width: var(--btn-size) !important;
      min-width: var(--btn-size) !important;
      max-height: var(--btn-size) !important;
      top: var(--spacing-xs);
      right: var(--spacing-xs);
      z-index: 1;
    }

    .autologin {
      display: inline-flex;
      align-items: center;

      span {
        margin-left: var(--spacing-m);
      }
    }
  }

  .bigBtnLayout {
    position: relative;
    width: 100%;
    height: var(--spacing-xxl);
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: var(--spacing-xxl);
    font-size: var(--font-20);
    font-weight: 500;
  }

  .siginInBtn {
    border-style: solid;
    border-width: 2px;
    border-color: var(--signin-green);
  }

  .siginInBtnEnabled {
    cursor: pointer;
    &:hover {
      filter: brightness(1.1);
      transition: 0.3s ease;
      background: var(--signin-green);
    }
  }

  .scanBtn {
    margin-top: calc(var(--spacing-m) * 1.5);

    position: relative;
    width: 100%;
    height: var(--spacing-xxl);
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: var(--spacing-xxl);
    font-size: var(--font-20);
    font-weight: 500;

    border-style: solid;
    border-width: 2px;
    border-color: var(--signin-green);

    cursor: pointer;
    &:hover {
      filter: brightness(1.1);
      transition: 0.3s ease;
      background: var(--signin-green);
    }
  }

  .createAccountBtn {
    cursor: pointer;
    background: var(--signin-orange);
    &:hover {
      filter: brightness(1.1);
      transition: 0.3s ease;
    }
  }

  .line {
    margin-top: calc(var(--spacing-m) * 0.75);
    margin-bottom: calc(var(--spacing-m) * 0.75);
    .textInLine {
      display: flex;
      align-items: center;
      text-align: center;
      font-size: var(--font-10);
      font-weight: 600;
      color: var(--signin-gray);
    }
    .textInLine::before,
    .textInLine::after {
      content: '';
      flex: 1;
      border-bottom: 1px solid var(--signin-gray);
    }
    .textInLine::before {
      margin-right: var(--spacing-s);
    }
    .textInLine::after {
      margin-left: var(--spacing-s);
    }
  }

  .footer {
    display: flex;
    align-items: center;
    justify-content: center;
    span {
      padding-right: var(--spacing-xs);
    }
    .heart {
      font-size: var(--font-24);
    }
  }
</style>
