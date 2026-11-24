<!--
 Copyright (C) 2020 - 2025 3NSoft Inc.

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
<script lang="ts" setup>
  import { computed, onBeforeMount, onBeforeUnmount, ref, watch, WatchHandle } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import isEmpty from 'lodash/isEmpty';
  import get from 'lodash/get';
  import { Ui3nCheckbox, Ui3nInput, Ui3nInputDate, Ui3nText } from '@v1nt1248/3nclient-lib';
  import { useAppStore } from '@main/common/store/app.store';
  import { useSettingsStore } from '@main/common/store/settings.store';
  import { randomStr } from '@main/common/services/base/random';
  import {
    contactDateToDate,
    dateToContactDate,
    getBirthday,
    isValidCalendarDay,
    withBirthday,
  } from '@main/common/utils/contact-dates';
  import { makeDateLocaleConfig } from '@main/common/utils/date-locale';
  import { isPhoneMaskApplicable, PHONE_MASK } from '@main/common/utils/phone-mask';
  import type { ContactContent, ContactDate, ContactTextField, Person } from '@main/types';

  const props = defineProps<{
    contact: ContactContent | Person;
    rules?: Record<string, ((value: unknown) => boolean | string)[]>;
    valid: boolean;
    disabled?: boolean;
    isMobileFormFactor?: boolean;
  }>();


  const emits = defineEmits<{
    (event: 'update:valid', value: boolean): void;
    (event: 'update:field', value: { field: ContactTextField; val: string }): void;
    (event: 'update:dates', value: ContactDate[]): void;
  }>();

  const { t } = useI18n();
  const { lang } = storeToRefs(useAppStore());
  const { dateFormat } = storeToRefs(useSettingsStore());

  const isValid = ref<Record<ContactTextField, boolean>>({
    name: fieldValidate('name'),
    mail: fieldValidate('mail'),
    phone: fieldValidate('phone'),
    notice: fieldValidate('notice'),
  });

  const innerValidValue = computed(() => Object.values(isValid.value).every(v => !!v));

  function fieldValidate(field: ContactTextField, value?: string) {
    const rules = getRules(field);
    if (isEmpty(rules)) {
      return true;
    } else {
      const res = rules.map(rule => rule(value || props.contact[field]));
      return res.every(r => typeof r !== 'string' && r);
    }
  }

  function onInput(ev: string, field: ContactTextField) {
    emits('update:field', { field, val: ev });

    (Object.keys(isValid.value) as ContactTextField[]).forEach(f => {
      isValid.value[f] = (f === field)
        ? fieldValidate(f, ev)
        : fieldValidate(f, props.contact[f]);
    });
  }

  function getRules(field: keyof ContactContent) {
    return get(props.rules, field, []);
  }

  /**
   * Masked only while the number is in the international form (or empty). A
   * number typed before the mask existed stays as it was; once it is cleared,
   * the mask takes over.
   */
  const phoneMask = computed(() => (isPhoneMaskApplicable(props.contact.phone) ? PHONE_MASK : undefined));

  const dateLocaleConfig = computed(() => makeDateLocaleConfig(lang.value, t('contact.content.birthdayWithoutYear')));

  const birthday = computed(() => getBirthday(props.contact.dates));
  const birthdayValue = computed(() => (birthday.value ? contactDateToDate(birthday.value) : null));

  /**
   * Whether the birthday is given without a year. Follows the stored date, and
   * otherwise keeps the user's choice in the picker for the date to be typed.
   */
  const isBirthdayWithoutYear = ref(false);
  watch(
    birthday,
    value => {
      if (value) {
        isBirthdayWithoutYear.value = value.year === undefined;
      }
    },
    { immediate: true },
  );

  function emitBirthday(value: ContactDate | undefined) {
    emits('update:dates', withBirthday(props.contact.dates, value));
  }

  function onBirthdayChange(value: Date | null) {
    if (!value) {
      emitBirthday(undefined);
      return;
    }

    const base = birthday.value ?? { id: randomStr(8), type: 'birthday' as const };
    emitBirthday(dateToContactDate(value, isBirthdayWithoutYear.value, base));
  }

  /**
   * The picker sends the date converted to the new mode right after this; it is
   * converted here as well, so that the stored date never depends on that.
   */
  function onBirthdayWithoutYearChange(value: boolean) {
    isBirthdayWithoutYear.value = value;
    const current = birthday.value;
    if (!current || (current.year === undefined) === value) {
      return;
    }

    const next: ContactDate = { ...current };
    if (value) {
      delete next.year;
    } else {
      next.year = new Date().getFullYear();
      if (!isValidCalendarDay(next.month, next.day, next.year)) {
        next.day = 28;
      }
    }
    emitBirthday(next);
  }

  function onBirthdayNotifyChange(value: unknown) {
    const current = birthday.value;
    if (!current) {
      return;
    }

    const next: ContactDate = { ...current };
    if (value === true) {
      next.notify = true;
    } else {
      delete next.notify;
    }
    emitBirthday(next);
  }

  let watchAllValid: WatchHandle;

  onBeforeMount(() => {
    watchAllValid = watch(
      () => innerValidValue.value,
      val => {
        emits('update:valid', val);
      },
      {
        immediate: true,
      },
    );
  });

  onBeforeUnmount(() => {
    watchAllValid.stop();
  });
</script>

<template>
  <div :class="isMobileFormFactor ? $style.contactContentMobile : $style.contactContent">
    <div :class="$style.field">
      <ui3n-input
        :model-value="contact.mail"
        :label="`${t('contact.content.identity')}*`"
        :rules="getRules('mail')"
        :disabled="disabled"
        @input="onInput($event, 'mail')"
      />
    </div>

    <div :class="$style.field">
      <ui3n-input
        :model-value="contact.name!"
        :label="t('contact.content.name')"
        :rules="getRules('name')"
        :disabled="disabled"
        @input="onInput($event, 'name')"
      />
    </div>

    <div :class="$style.field">
      <ui3n-input
        :model-value="contact.phone!"
        :label="t('contact.content.phone')"
        :rules="getRules('phone')"
        :disabled="disabled"
        :mask="phoneMask"
        @input="onInput($event, 'phone')"
      />
    </div>

    <div
      :class="$style.field"
      data-field="birthday"
    >
      <ui3n-input-date
        :model-value="birthdayValue"
        :label="t('contact.content.birthday')"
        :format="dateFormat"
        :without-year="isBirthdayWithoutYear"
        :locale-config="dateLocaleConfig"
        allow-without-year
        clearable
        :disabled="disabled"
        @update:model-value="onBirthdayChange"
        @update:without-year="onBirthdayWithoutYearChange"
      />

      <ui3n-checkbox
        :model-value="!!birthday?.notify"
        :disabled="disabled || !birthday"
        :class="$style.notify"
        @change="onBirthdayNotifyChange"
      >
        {{ t('contact.content.birthdayNotify') }}
      </ui3n-checkbox>
    </div>

    <div :class="$style.field">
      <ui3n-text
        :model-value="contact.notice!"
        :label="t('contact.content.note')"
        :rows="6"
        :max-rows="6"
        :rules="getRules('notice')"
        :disabled="disabled"
        @input="onInput($event, 'notice')"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .contactContent {
    position: relative;
    width: 100%;
    height: 100%;
    padding-right: var(--spacing-m);
  }

  .contactContentMobile {
    position: relative;
    width: 100%;
    height: 100%;
    padding-right: var(--spacing-xs);
  }

  .field {
    padding-bottom: var(--spacing-s);
  }

  .notify {
    margin-top: var(--spacing-xs);
  }
</style>
