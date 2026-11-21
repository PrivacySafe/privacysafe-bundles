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
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import size from 'lodash/size';
  import VueCCard from 'vue-ccard';
  import 'vue-ccard/src/style.css';
  import { Ui3nInput } from '@v1nt1248/3nclient-lib';
  import type { TreasureBankCardRecord, TreasureGroup, TreasureRecord } from '@shared/@types';
  import CustomScrollBar from '@/common/components/custom-scroll-bar.vue';

  const props = defineProps<{
    record: TreasureBankCardRecord;
    records?: TreasureRecord[];
    sortedGroups: TreasureGroup[];
    mobileMode?: boolean;
    isLoading?: boolean;
  }>();

  const emits = defineEmits<{
    (event: 'update:record', payload: TreasureRecord): void;
    (event: 'update:validation-flag', payload: boolean): void;
  }>();

  const { t } = useI18n();

  const recordName = [(v: unknown) => !!v || t('recordDialog.form.fields.bancCardName.required')];
  const cardNumberRules = [
    (v: unknown) => !!v || t('recordDialog.form.fields.cardNumber.required'),
    (v: unknown) => {
      const val = formatCardNumber(v as string);
      return size(val) === 19 || t('recordDialog.form.fields.cardNumber.length');
    },
  ];
  const cardHolderRules = [(v: unknown) => !!v || t('recordDialog.form.fields.cardHolder.required')];
  const cardExpRules = [
    (v: unknown) => !!v || t('recordDialog.form.fields.cardExp.required'),
    (v: unknown) => validateExpiryDate(v as string),
  ];
  const cardCvvRules = [
    (v: unknown) => !!v || t('recordDialog.form.fields.cardCvv.required'),
    (v: unknown) => validateCvv(v as string),
  ];

  const isTypingCvc = ref(false);

  const cardNumberInputElement = ref<HTMLInputElement>();
  const cardExpInputElement = ref<HTMLInputElement>();
  const cardCvvInputElement = ref<HTMLInputElement>();

  const validation = ref({
    name: props.record.id !== 'new',
    resource: props.record.id !== 'new',
    username: props.record.id !== 'new',
    exp: props.record.id !== 'new',
    password: props.record.id !== 'new',
  });
  const errorMessages = ref({
    name: '',
    resource: '',
    username: '',
    exp: '',
    password: '',
  });

  const isFormValid = computed(
    () =>
      validation.value.name &&
      validation.value.resource &&
      validation.value.username &&
      validation.value.password &&
      validation.value.exp &&
      !errorMessages.value.name &&
      !errorMessages.value.resource &&
      !errorMessages.value.username &&
      !errorMessages.value.password &&
      !errorMessages.value.exp,
  );

  function onCardNumberInputElementInit(el: HTMLInputElement) {
    cardNumberInputElement.value = el;
    cardNumberInputElement.value.maxLength = 19;
  }

  function onCardExpInputElementInit(el: HTMLInputElement) {
    cardExpInputElement.value = el;
    cardExpInputElement.value.maxLength = 5;
  }

  function onCardCvvInputElementInit(el: HTMLInputElement) {
    cardCvvInputElement.value = el;
    cardCvvInputElement.value.maxLength = 4;
  }

  function handleInputRecordName(v: string) {
    emits('update:record', {
      ...props.record,
      name: v,
    });
  }

  function formatCardNumber(v: string) {
    let value = v.replace(/\s/g, '').replace(/\D/g, '');
    value = value.match(/.{1,4}/g)?.join(' ') || '';
    return value;
  }

  function handleInputCardNumber(v: string) {
    const value = formatCardNumber(v);
    cardNumberInputElement.value!.value = value;

    emits('update:record', {
      ...props.record,
      resource: value,
    });
  }

  function handleInputCardHolder(v: string) {
    const value = v.toUpperCase();

    emits('update:record', {
      ...props.record,
      username: value,
    });
  }

  function handleInputCardExp(v: string) {
    let value = v.replace(/\D/g, '').slice(0, 4);

    if (value.length > 2) {
      value = `${value.slice(0, 2)}/${value.slice(2)}`;
    }

    cardExpInputElement.value!.value = value;

    emits('update:record', {
      ...props.record,
      exp: value,
    });
  }

  function handleInputCardCvv(v: string) {
    const value = v.replace(/\D/g, '').slice(0, 4);
    cardCvvInputElement.value!.value = value;

    emits('update:record', {
      ...props.record,
      password: value,
    });
  }

  function validateExpiryDate(value: string): boolean | string {
    if (!/^\d{2}\/\d{2}$/.test(value)) {
      return t('recordDialog.form.fields.cardExp.format');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [monthStr, yearStr] = value.split('/');
    const month = parseInt(monthStr, 10);
    // const year = parseInt(yearStr, 10) + 2000;

    if (month < 1 || month > 12) {
      return t('recordDialog.form.fields.cardExp.month');
    }

    // const currentDate = new Date();
    // const currentYear = currentDate.getFullYear();
    // const currentMonth = currentDate.getMonth() + 1;
    //
    // if (year < currentYear) {
    //   return false;
    // }
    //
    // if (year === currentYear && month < currentMonth) {
    //   return false;
    // }

    return true;
  }

  function updateValidation(field: 'name' | 'resource' | 'username' | 'exp' | 'password', val: boolean) {
    validation.value[field] = val;
  }

  function validateCvv(value: string): boolean | string {
    return /^\d{3,4}$/.test(value) || t('recordDialog.form.fields.cardCvv.length');
  }

  watch(
    isFormValid,
    val => {
      emits('update:validation-flag', val);
    },
    {
      immediate: true,
    },
  );
</script>

<template>
  <div :class="[$style.bankCardEditor, isLoading && $style.blurry]">
    <custom-scroll-bar :thumb-height="240">
      <div :class="$style.row">
        <ui3n-input
          :model-value="record.name"
          :label="`${t('recordDialog.form.fields.bancCardName.label')}*`"
          :placeholder="t('recordDialog.form.fields.bancCardName.placeholder')"
          :rules="recordName"
          :display-state-mode="errorMessages.name ? 'error' : undefined"
          :display-state-message="errorMessages.name"
          :disabled="isLoading"
          @input="(v: string) => handleInputRecordName(v)"
          @update:valid="(v: boolean) => updateValidation('name', v)"
        />
      </div>

      <div :class="$style.cardWrapper">
        <vue-c-card
          :number="record.resource"
          :holder="record.username"
          :exp="record.exp"
          :cvc="record.password"
          :is-typing-cvc="isTypingCvc"
          :width="300"
        />
      </div>

      <div :class="$style.row">
        <ui3n-input
          :model-value="record.resource"
          :label="`${t('recordDialog.form.fields.cardNumber.label')}*`"
          :placeholder="t('recordDialog.form.fields.cardNumber.placeholder')"
          :rules="cardNumberRules"
          :display-state-mode="errorMessages.resource ? 'error' : undefined"
          :display-state-message="errorMessages.resource"
          :disabled="isLoading"
          @init="onCardNumberInputElementInit"
          @input="(v: string) => handleInputCardNumber(v)"
          @update:valid="(v: boolean) => updateValidation('resource', v)"
        />
      </div>

      <div :class="$style.row">
        <ui3n-input
          :model-value="record.username"
          :label="`${t('recordDialog.form.fields.cardHolder.label')}*`"
          :placeholder="t('recordDialog.form.fields.cardHolder.placeholder')"
          :rules="cardHolderRules"
          :display-state-mode="errorMessages.username ? 'error' : undefined"
          :display-state-message="errorMessages.username"
          :disabled="isLoading"
          @input="(v: string) => handleInputCardHolder(v)"
          @update:valid="(v: boolean) => updateValidation('username', v)"
        />
      </div>

      <div :class="[$style.row, $style.double]">
        <ui3n-input
          :model-value="record.exp"
          :label="`${t('recordDialog.form.fields.cardExp.label')}*`"
          :placeholder="t('recordDialog.form.fields.cardExp.placeholder')"
          :rules="cardExpRules"
          :display-state-mode="errorMessages.exp ? 'error' : undefined"
          :display-state-message="errorMessages.exp"
          :disabled="isLoading"
          @init="onCardExpInputElementInit"
          @input="(v: string) => handleInputCardExp(v)"
          @update:valid="(v: boolean) => updateValidation('exp', v)"
        />

        <ui3n-input
          :model-value="record.password"
          type="password"
          :label="`${t('recordDialog.form.fields.cardCvv.label')}*`"
          :placeholder="t('recordDialog.form.fields.cardCvv.placeholder')"
          :rules="cardCvvRules"
          :display-state-mode="errorMessages.password ? 'error' : undefined"
          :display-state-message="errorMessages.password"
          :disabled="isLoading"
          @init="onCardCvvInputElementInit"
          @focus="() => (isTypingCvc = true)"
          @blur="() => (isTypingCvc = false)"
          @input="(v: string) => handleInputCardCvv(v)"
          @update:valid="(v: boolean) => updateValidation('password', v)"
        />
      </div>
    </custom-scroll-bar>
  </div>
</template>

<style lang="scss" module>
  .bankCardEditor {
    position: relative;
    width: 100%;
    max-height: calc(100dvh - 160px);
    padding: var(--spacing-m) 0 var(--spacing-m) var(--spacing-m);

    &.blurry {
      filter: blur(2px);
    }

    .cardWrapper {
      display: flex;
      justify-content: center;
      align-items: center;
      margin-bottom: var(--spacing-m);

      & > div {
        --font-number: 17px !important;
        --font-text: 14px !important;

        p {
          text-shadow: 2px 2px 5px var(--shadow-back);
        }
      }
    }

    .row {
      position: relative;
      width: 100%;
      margin-bottom: var(--spacing-s);

      &.double {
        display: flex;
        justify-content: flex-start;
        align-items: flex-end;
        column-gap: var(--spacing-m);
      }
    }

    div[class*='scrollbarContainer'] {
      max-height: calc(100dvh - 160px);
      margin-top: -12px;
      padding-top: 12px;
      padding-right: var(--spacing-m);
    }
  }
</style>
