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
  import { computed, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useSignupStore } from '@/stores/signup.store';
  import { Ui3nButton, Ui3nInput, Ui3nSwitch } from '@v1nt1248/3nclient-lib';
  import { isStringOk } from '@/utils/validations';
  import { strictASCiiForPassword } from '@/utils/unicode-ranges';
import { useAutologinsStore } from '@/stores/autologin.store';
import { storeToRefs } from 'pinia';

  const validPasswordSymbols = '! # * $ % & ( ) + - : ; ? . @ ^ _ ~ ';

  const emits = defineEmits<{
    (event: 'change:step', payload: { step: number; query?: Record<string, string> }): void;
    (event: 'change:step-title', payload: { title: string; }): void;
  }>();

  const { t } = useI18n();
  const { setStoreFieldValue, address } = useSignupStore();
  emits('change:step-title', { title: address });

  const autologinStore = useAutologinsStore();
  const { isAutologinAvailable } = autologinStore;
  const { autoLoginEnabled } = storeToRefs(autologinStore);
  // init value for signup flow
  autoLoginEnabled.value = true;

  const password = ref({
    txt: '',
    badCharErr: false,
  });

  const confirmation = ref('');

  function onPasswordChange() {
    confirmation.value = '';
    password.value.badCharErr = !isStringOk(password.value.txt, strictASCiiForPassword);
  }

  const isShortPassword = computed(() => (password.value.txt.length < 12));

  const isPasswordOk = computed(() => (!isShortPassword.value && !password.value.badCharErr));

  const isFormValid = computed(() => isPasswordOk.value && (password.value.txt === confirmation.value));

  function usePasswordInNextStep() {
    if (!isFormValid.value) {
      return;
    }
    setStoreFieldValue('password', password.value.txt);
    emits('change:step', { step: 4 });
  }

</script>

<template>
  <div :class="$style.step3">
    <div :class="$style.main">

      <ui3n-input
        v-model="password.txt"
        type="password"
        :placeholder="t('placeholder.create_password')"
        :display-state-mode="
          password.badCharErr ? 'error'
            : isShortPassword ? undefined : 'success'
        "
        :class="$style.password"
        @update:model-value="onPasswordChange"
      />

      <div :class="$style.text"
        v-if="isShortPassword"
      >
        <span>{{ t('signup.step.create_password.pass_length_txt') }}</span>
      </div>

      <div :class="$style.text"
        v-if="password.badCharErr"
      >
        <span>{{ t('signup.step.create_password.pass_chars_txt') }} {{ validPasswordSymbols }}</span>
      </div>

      <ui3n-input
        v-if="isPasswordOk"
        v-model="confirmation"
        type="password"
        :placeholder="t('placeholder.confirm_password')"
        :display-state-mode="isFormValid ? 'success' : undefined"
        :class="$style.password"
      />

      <div :class="$style.text"
        v-if="isPasswordOk && !isFormValid"
      >
        <span>{{ t('signup.step.create_password.confirmation_txt') }}</span>
      </div>

      <div :class="$style.autologin"
        v-if="isAutologinAvailable && isFormValid"
      >
        <ui3n-switch
          v-model="autoLoginEnabled"
          size="24"
        />
        <span>{{ t(autoLoginEnabled ? 'autologin.on' : 'autologin.off') }}</span>
      </div>

    </div>

    <ui3n-button
      block
      :disabled="!isFormValid"
      :class="$style.nextBtn"
      @click="usePasswordInNextStep"
    >
      {{ t('signup.step.btn.next') }}
    </ui3n-button>
  </div>
</template>

<style lang="scss" module>
  .step3 {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;

    .main {
      position: relative;
      width: 100%;
      min-height: calc(var(--spacing-xxl)*2.75);
      padding-top: var(--spacing-m);
      margin-bottom: var(--spacing-l);
    }

    .text {
      font-size: var(--font-14);
      font-weight: 400;
      line-height: 1.5;
    }

    .password {
      margin-bottom: var(--spacing-m);
    }

    .autologin {
      display: inline-flex;
      align-items: center;

      span {
        margin-left: var(--spacing-m);
      }
    }

    .nextBtn {
      height: var(--spacing-xl);
      border-radius: var(--spacing-xl);

      span {
        font-size: var(--font-16);
      }
    }
  }
</style>
