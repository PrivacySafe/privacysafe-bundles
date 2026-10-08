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
  import isEmpty from 'lodash/isEmpty';
  import get from 'lodash/get';
  import { Ui3nInput, Ui3nText } from '@v1nt1248/3nclient-lib';
  import type { ContactContent, ContactTextField, Person } from '@main/types';

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
  }>();

  const { t } = useI18n();

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
        @input="onInput($event, 'phone')"
      />
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
</style>
