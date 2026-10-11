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
  import { getRandomId } from '@v1nt1248/3nclient-lib/utils';
  import { Ui3nButton, Ui3nInput, Ui3nSelector } from '@v1nt1248/3nclient-lib';
  import type { TreasureGroup, TreasurePasswordRecord, TreasureRecord } from '@shared/@types';

  const props = defineProps<{
    record: TreasurePasswordRecord;
    records?: TreasureRecord[];
    sortedGroups: TreasureGroup[];
    isLoading?: boolean;
  }>();
  const emits = defineEmits<{
    (event: 'update:record', payload: TreasureRecord): void;
    (event: 'update:validation-flag', payload: boolean): void;
  }>();

  const { t } = useI18n();

  const resourceRules = [(v: unknown) => !!v || t('recordDialog.form.fields.resource.required')];
  const usernameRules = [(v: unknown) => !!v || t('recordDialog.form.fields.username.required')];
  const passwordRules = [(v: unknown) => !!v || t('recordDialog.form.fields.password.required')];

  const showPassword = ref(false);
  const validation = ref({
    resource: props.record.id !== 'new',
    username: props.record.id !== 'new',
    password: props.record.id !== 'new',
  });
  const errorMessages = ref({
    resource: '',
    username: '',
  });

  const isFormValid = computed(
    () =>
      validation.value.resource &&
      validation.value.username &&
      validation.value.password &&
      !errorMessages.value.resource &&
      !errorMessages.value.username,
  );

  if (props.record.id !== 'new') {
    doubleValidate();
  }

  function doubleValidate() {
    const currentId = props.record.id;
    const duplicate = (props.records || []).find(
      r =>
        r.resource === props.record.resource &&
        (r as TreasurePasswordRecord).username === props.record.username &&
        r.id !== currentId,
    );

    errorMessages.value = {
      resource: duplicate ? t('recordDialog.form.fields.resource.unique') : '',
      username: duplicate ? t('recordDialog.form.fields.username.unique') : '',
    };
  }

  function updateValidation(field: 'resource' | 'username' | 'password', val: boolean) {
    validation.value[field] = val;
  }

  function handleInput(field: keyof TreasureRecord, value: string) {
    emits('update:record', {
      ...props.record,
      [field]: value,
    });
    doubleValidate();
  }

  function generatePassword() {
    emits('update:record', {
      ...props.record,
      password: getRandomId(16),
    });
    validation.value.password = true;
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
  <div :class="[$style.recordEditor, isLoading && $style.blurry]">
    <div :class="$style.row">
      <ui3n-input
        :model-value="record.name || ''"
        :label="t('recordDialog.form.fields.name.label')"
        :placeholder="t('recordDialog.form.fields.name.placeholder')"
        :disabled="isLoading"
        @update:model-value="(v: string) => handleInput('name', v)"
      />
    </div>

    <div :class="$style.row">
      <ui3n-input
        :model-value="record.resource"
        :label="`${t('recordDialog.form.fields.resource.label')}*`"
        :placeholder="t('recordDialog.form.fields.resource.placeholder')"
        :rules="resourceRules"
        :display-state-mode="errorMessages.resource ? 'error' : undefined"
        :display-state-message="errorMessages.resource"
        :disabled="isLoading"
        @update:model-value="(v: string) => handleInput('resource', v)"
        @update:valid="(v: boolean) => updateValidation('resource', v)"
      />
    </div>

    <div :class="$style.row">
      <ui3n-input
        :model-value="record.username"
        :label="`${t('recordDialog.form.fields.username.label')}*`"
        :placeholder="t('recordDialog.form.fields.username.placeholder')"
        :rules="usernameRules"
        :display-state-mode="errorMessages.username ? 'error' : undefined"
        :display-state-message="errorMessages.username"
        :disabled="isLoading"
        @update:model-value="(v: string) => handleInput('username', v)"
        @update:valid="(v: boolean) => updateValidation('username', v)"
      />
    </div>

    <div :class="[$style.row, $style.password]">
      <div :class="$style.wrapper">
        <ui3n-input
          :model-value="record.password"
          :type="showPassword ? 'text' : 'password'"
          :label="`${t('recordDialog.form.fields.password.label')}*`"
          :placeholder="t('recordDialog.form.fields.password.placeholder')"
          :rules="passwordRules"
          :disabled="isLoading"
          :class="$style.passwordField"
          @update:model-value="(v: string) => handleInput('password', v)"
          @update:valid="(v: boolean) => updateValidation('password', v)"
        />

        <ui3n-button
          type="icon"
          size="small"
          color="var(--color-bg-control-secondary-default)"
          :icon="showPassword ? 'eye-off-outline' : 'eye-outline'"
          icon-color="var(--color-icon-control-accent-default)"
          icon-size="16"
          :class="$style.showBtn"
          @click.stop.prevent="showPassword = !showPassword"
        />
      </div>

      <ui3n-button
        type="custom"
        color="var(--color-bg-button-tritery-default)"
        text-color="var(--color-text-button-tritery-default)"
        :class="$style.generateBtn"
        @click.stop.prevent="generatePassword"
      >
        {{ t('recordDialog.form.btns.generate') }}
      </ui3n-button>
    </div>

    <div :class="$style.row">
      <ui3n-selector
        :model-value="record.group"
        :label="t('recordDialog.form.fields.group.label')"
        :placeholder="t('recordDialog.form.fields.group.placeholder')"
        :items="sortedGroups"
        item-display="name"
        clearable
        :disabled="isLoading"
        @update:model-value="(v: string) => handleInput('group', v || '')"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .recordEditor {
    position: relative;
    width: 100%;
    max-height: calc(100dvh - 160px);
    padding: var(--spacing-m);

    &.blurry {
      filter: blur(2px);
    }

    .row {
      position: relative;
      width: 100%;
      margin-bottom: var(--spacing-s);

      &.password {
        display: flex;
        justify-content: flex-start;
        align-items: flex-end;
        column-gap: var(--spacing-m);
      }

      .passwordField {
        input {
          padding-right: var(--spacing-l);
        }
      }

      .showBtn {
        position: absolute;
        right: 4px;
        top: 24px;
      }
    }

    .wrapper {
      position: relative;
      flex-grow: 1;
    }

    .generateBtn {
      min-width: 144px;
      width: 144px;
      bottom: 15px;
    }

    .groupSelector {
      border-radius: 4px;
      background-color: var(--color-bg-control-secondary-default);
    }
  }
</style>
