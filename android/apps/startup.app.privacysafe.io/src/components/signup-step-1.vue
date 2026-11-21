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
  import { inject, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { NOTIFICATIONS_KEY } from '@v1nt1248/3nclient-lib/plugins';
  import { Ui3nButton, Ui3nInput, Ui3nRipple as vUi3nRipple, Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import { useSignupStore } from '@/stores/signup.store';
  import { stdSignupLink, tokens } from '@/constants';
  import { parse3NWebURL } from '@/utils/signup-links';
  import StartupFooter from './startup-footer.vue';

  const emits = defineEmits<{
    (event: 'change:step', payload: { step: number; query?: Record<string, string> }): void;
    (event: 'change:step-title', payload: { title: string }): void;
  }>();

  const { t } = useI18n();
  const { $createNotice } = inject(NOTIFICATIONS_KEY)!;
  const { getDomainsFor, setStoreFieldValue } = useSignupStore();

  const customTokenOrLink = ref('');
  const isProcessing = ref(false);

  async function selectProvider(key: 'silver' | 'gold' | 'platinum') {
    try {
      isProcessing.value = true;
      const selectedToken = tokens[key].value;
      if (selectedToken) {
        const signupLink = `${stdSignupLink}${selectedToken}`;
        await checkSignupParamsAndSwitchIfServerGivesDomains(signupLink);
      } else {
        const urlToGetToken = tokens[key].url;
        await w3n.provider.openInExternal(urlToGetToken);
      }
    } finally {
      isProcessing.value = false;
    }
  }

  async function checkSignupParamsAndSwitchIfServerGivesDomains(signupLink: string, popErr = true) {
    const params = parse3NWebURL(signupLink);
    if (!params) {
      return;
    }

    const { token, isStandardService } = params;
    const { domains, errMsgLabel, okMsgLabel } = await getDomainsFor(params);

    if (domains) {
      const domainToChoose = domains[0];

      setStoreFieldValue('signupLink', signupLink);
      setStoreFieldValue('isStandardService', !!isStandardService);
      setStoreFieldValue('srvToken', token ?? '');
      setStoreFieldValue('availableDomains', domains);
      setStoreFieldValue('userDomain', domainToChoose);

      emits('change:step', {
        step: 2,
        query: {
          ...(token && { token }),
          domain: domainToChoose,
        },
      });
      return;
    }

    if (popErr) {
      $createNotice({
        type: 'error',
        content: errMsgLabel!,
      });
    }
  }

  function openHostOwnBrowserPage() {
    w3n.provider.openInExternal(`https://github.com/PrivacySafe/3nweb-service`);
    // w3n.provider.openInExternal(`https://psafe.ly/app-host-dom`);
  }

  function openAccountHelpBrowserPage() {
    w3n.provider.openInExternal(`https://psafe.ly/app-donate`);
    // w3n.provider.openInExternal(`https://psafe.ly/app-acc-help`);
  }

  async function applyCustomLinkOrToken(linkOrToken: string) {
    if (parse3NWebURL(linkOrToken)) {
      await checkSignupParamsAndSwitchIfServerGivesDomains(linkOrToken, false);
    } else {
      const signupLink = `${stdSignupLink}${linkOrToken}`;
      await checkSignupParamsAndSwitchIfServerGivesDomains(signupLink, false);
    }
  }

  onMounted(() => {
    emits('change:step-title', { title: t(`signup.provider.stepTitle`) });
  });
</script>

<template>
  <div :class="$style.step1">
    <div :class="$style.providers">
      <template
        v-for="({ domain, assetsImage }, key) in tokens"
        :key="key"
      >
        <div
          v-ui3n-ripple
          :class="[$style.provider, isProcessing && $style.disabled, $style[`${key}-provider`]]"
          @click="() => selectProvider(key)"
        >
          <img :src="assetsImage" />
          <div>
            <span :class="$style.providerTitle">{{ t(`signup.provider.${key}.title`) }}</span>
            <br />
            <span :class="$style.providerInfo">
              <span :class="$style.providerType">{{ t(`signup.provider.${key}.type`) }}</span>
              {{ t(`signup.provider.${key}.info`, { domain: `@${domain}` }) }}</span
            >
          </div>
        </div>
      </template>
    </div>

    <div :class="$style.signUpLinkOrToken">
      <div :class="$style.line">
        <span :class="$style.textInLine">{{ t('signup.provider.existing_signup_link') }}</span>
      </div>

      <div :class="$style.tokenSignUp">
        <ui3n-input
          v-model="customTokenOrLink"
          :disabled="isProcessing"
          :placeholder="t('signup.provider.custom_link.input_placeholder')"
          :class="$style.tokenInput"
          @update:model-value="applyCustomLinkOrToken"
          @keyup.enter="applyCustomLinkOrToken(customTokenOrLink)"
        >
          <template #append-icon>
            <ui3n-icon icon="link-variant" />
          </template>
        </ui3n-input>
      </div>
      <div :class="$style.customLink">
        <ui3n-button
          type="tertiary"
          @click="openAccountHelpBrowserPage"
        >
          {{ t('signup.provider.custom_link.account_help') }}
        </ui3n-button>
      </div>
    </div>

    <startup-footer>
      <div :class="$style.footer">
        <ui3n-icon
          icon="round-language"
          width="16"
          height="16"
          :class="$style.iconToken"
        />
        <ui3n-button
          type="tertiary"
          @click="openHostOwnBrowserPage"
        >
          {{ t('signup.provider.footer_info_link_txt') }}
        </ui3n-button>
      </div>
    </startup-footer>
  </div>
</template>

<style lang="scss" module>
  .step1 {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .providers {
    width: 100%;
    padding-left: var(--spacing-l);
    padding-right: var(--spacing-l);
    margin-bottom: var(--spacing-xxl);

    .provider {
      margin-bottom: var(--spacing-m);
      display: flex;
      align-items: center;
      padding: var(--spacing-m);
      border-radius: 12px;
      border: 1.5px solid color-mix(in oklch, var(--default-fill-default), transparent 80%);
      text-shadow: 0 1px 2px oklch(0% 0 0 / 0.4);
      line-height: 1;
      cursor: pointer;
      transition: 0.3s ease;

      img {
        max-width: calc(var(--spacing-l) * 2);
        margin-right: var(--spacing-s);
      }

      .providerTitle {
        font-size: var(--font-24);
        font-weight: 600;
      }

      .providerInfo {
        font-size: var(--font-14);
        font-weight: 400;
      }

      .providerType {
        font-weight: bold;
      }

      &.silver-provider {
        background: #14273f;
        border: 1px solid #4ea2f5;

        .providerType {
          color: #4ea2f5;
        }
      }

      &.gold-provider {
        background: #5d3c04;
        border: 1px solid #f0b121;

        .providerType {
          color: #f0b121;
        }
      }

      &.platinum-provider {
        background: #323d49;
        border: 1px solid #9cb3c6;

        .providerType {
          color: #9cb3c6;
        }
      }

      &:not(.disabled):hover {
        border-color: var(--default-fill-default);
        transition: 0.3s ease;
        filter: brightness(1.1);
      }

      &.disabled {
        pointer-events: none;
        cursor: default;
      }
    }
  }

  .signUpLinkOrToken {
    width: 100%;
    padding-left: var(--spacing-m);
    padding-right: var(--spacing-m);

    .line {
      margin-bottom: calc(var(--spacing-m) * 0.75);
      .textInLine {
        display: flex;
        align-items: center;
        text-align: center;
        color: var(--signin-gray);
        font-size: var(--font-12);
        font-weight: 600;
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

    .tokenSignUp {
      display: flex;

      .tokenInput {
        padding: 0;
      }
    }

    .customLink {
      display: flex;
      flex-direction: column;
      align-items: end;
      margin-top: var(--spacing-s);
    }
  }

  .footer {
    display: flex;
    align-items: center;
    justify-content: center;
    padding-left: var(--spacing-m);
    padding-right: var(--spacing-m);
    text-align: center;

    .iconToken {
      color: var(--color-text-control-primary-default) !important;
    }
  }
</style>
