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
  import { ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useRoute } from 'vue-router';
  import { storeToRefs } from 'pinia';
  import { Ui3nButton, Ui3nInput, Ui3nInputProps, Ui3nProgressLinear } from '@v1nt1248/3nclient-lib';
  import { useSignupStore } from '@/stores/signup.store';
  import { areAddressesEqual } from '@/utils/canonical-address';
import { isStringOk } from '@/utils/validations';
import { strictASCiiForUsername } from '@/utils/unicode-ranges';

  const emits = defineEmits<{
    (event: 'change:step', payload: { step: number; query?: Record<string, string> }): void;
    (event: 'change:step-title', payload: { title: string; }): void;
  }>();

  const { t } = useI18n();
  const route = useRoute();

  const signupStore = useSignupStore();
  const { userDomain, srvToken, availableDomains } = storeToRefs(signupStore);
  const { setStoreFieldValue } = signupStore;

  if (route.query.token && !srvToken.value) {
    setStoreFieldValue('srvToken', route.query.token as string);
  }

  if (route.query.domain && !userDomain.value) {
    setStoreFieldValue('userDomain', route.query.domain as string);
  }

  function isNameShort(u: string): boolean {
    return (u.length < 6);
  }

  function isNameLong(u: string): boolean {
    return (u.length > 60);
  }

  function areCharsOkIn(u: string): boolean {
    return isStringOk(u, strictASCiiForUsername);
  }

  const username = ref('');
  const inputState = ref<Ui3nInputProps['displayStateMode']>(undefined);
  const isProcessing = ref(false);
  const showCharLimits = ref(false);
  const isLatestValueAvailable = ref(false);

  function onUsernameChange() {
    const newName = username.value;
    isLatestValueAvailable.value = false;
    if (inputState.value === 'success') {
      inputState.value = undefined;
    }
    scheduledCheck.value = undefined;
    if (areCharsOkIn(newName)) {
      if (!isNameShort(newName)) {
        if (isNameLong(newName)) {
          setTimeout(() => {
            username.value = newName.substring(0, newName.length-1);
            onUsernameChange();
          }, 1);
        } else {
          scheduleAvailabilityCheck(newName);
        }
      }
    } else {
      showCharLimits.value = true;
      flashUsernameError();
      setTimeout(() => {
        let choppedName = newName;
        do {
          choppedName = ((choppedName.length > 2) ? choppedName.substring(0, choppedName.length-1) : '');
        } while (!areCharsOkIn(choppedName));
        username.value = choppedName;
        onUsernameChange();
      }, 1);
      return;
    }

    updateStepTitle();
  }

  function updateStepTitle() {
    const currentAddr = `${username.value}@${userDomain.value}`;
    emits('change:step-title', { title: currentAddr });
  }

  function flashUsernameError() {
    if (inputState.value !== 'error') {
      inputState.value = 'error';
      setTimeout(() => {
        inputState.value = undefined;
      }, 2000);
    }
  }

  const scheduledCheck = ref<{
    usernameToCheck: string;
    timeoutId: number;
  }|undefined>(undefined);

  function scheduleAvailabilityCheck(username: string) {
    if (scheduledCheck.value) {
      const { usernameToCheck, timeoutId } = scheduledCheck.value;
      if (usernameToCheck === username) {
        return;
      } else {
        clearTimeout(timeoutId);
      }
    }
    scheduledCheck.value = {
      usernameToCheck: username,
      timeoutId: setTimeout(performScheduledCheck, 400) as unknown as number
    };
  }

  async function performScheduledCheck(): Promise<void> {
    if (!scheduledCheck.value) {
      return;
    }
    const { usernameToCheck } = scheduledCheck.value;
    if (usernameToCheck !== username.value) {
      return;
    }
    try {
      isProcessing.value = true;
      const token = srvToken.value || undefined;
      const availableAddresses = await w3n.signUp.getAvailableAddresses(username.value, token);
      if ((usernameToCheck !== username.value)
      || (scheduledCheck.value?.usernameToCheck !== usernameToCheck)) {
        return;
      } else {
        scheduledCheck.value = undefined;
      }
      const currentAddr = `${username.value}@${userDomain.value}`;      
      if (availableAddresses.find(addr => areAddressesEqual(addr, currentAddr))) {
        isLatestValueAvailable.value = true;
        inputState.value = 'success';
      }
    } finally {
      isProcessing.value = false;
    }
  }

  function useCurrentUsernameInNextStep() {
    const currentAddr = `${username.value}@${userDomain.value}`;      
    setStoreFieldValue('username', username.value);
    setStoreFieldValue('address', currentAddr);
    emits('change:step', { step: 3 });
  }

  updateStepTitle();

</script>

<template>
  <div :class="$style.step2">
    <div :class="$style.main">

      <ui3n-input
        v-model="username"
        :placeholder="t('placeholder.username')"
        :display-state-mode="inputState"
        @update:model-value="onUsernameChange"
      />

      <div :class="$style.progressLayout">
        <ui3n-progress-linear indeterminate
          v-if="!!scheduledCheck"
          :color="'var(--signin-green)'"
        />
      </div>

      <!-- <div :class="$style.row">
        <span :class="$style.rowLabel">{{ t('signup.step.create_user.domain_label') }}:</span>
        <span :class="$style.rowValue">@{{ userDomain }}</span>
      </div> -->

      <div :class="$style.text"
        v-if="isNameShort(username)"
      >
        {{ t('signup.step.create_user.username_length_txt') }}
      </div>

      <div :class="[ $style.text, ((inputState === 'error') ? $style.errorFlash : '') ]"
        v-if="showCharLimits"
      >
        {{ t('signup.step.create_user.username_chars_txt') }}
      </div>

    </div>

    <ui3n-button
      block
      :disabled="!isLatestValueAvailable || isProcessing"
      :class="$style.nextBtn"
      @click="useCurrentUsernameInNextStep"
    >
      {{ t('signup.step.btn.next') }}
    </ui3n-button>
  </div>
</template>

<style lang="scss" module>
  .step2 {
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
      display: inline-block;
      font-size: var(--font-14);
      font-weight: 400;
      line-height: 1.5;
    }

    .errorFlash {
      color: var(--error-content-focused);
    }

    .progressLayout {
      width: 100%;
      min-height: var(--spacing-xs);
      margin-bottom: var(--spacing-s);
    }

    .row {
      display: flex;
      width: 100%;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--spacing-m);

      .rowLabel {
        font-size: var(--font-14);
        font-weight: 500;
        line-height: var(--font-20);
      }

      .rowValue {
        font-size: var(--font-13);
        font-weight: 600;
        line-height: var(--font-16);
        color: var(--color-text-block-accent-default);
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
