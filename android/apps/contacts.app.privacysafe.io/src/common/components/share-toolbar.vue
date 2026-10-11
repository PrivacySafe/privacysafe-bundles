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
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Ui3nButton, Ui3nCheckbox, type Ui3nCheckboxValue } from '@v1nt1248/3nclient-lib';

  const props = withDefaults(
    defineProps<{
      markedContacts?: string[];
      unblockedContacts?: string[];
      isMobileFormFactor?: boolean;
    }>(),
    {
      markedContacts: () => [],
      unblockedContacts: () => [],
    },
  );

  const emits = defineEmits<{
    (ev: 'cancel'): void;
    (ev: 'update:marked-contacts', value: string[]): void;
    (ev: 'share'): void;
  }>();

  const { t } = useI18n();

  const totalContacts = computed(() => props.unblockedContacts?.length || 0);

  function onUpdate(v: Ui3nCheckboxValue) {
    emits('update:marked-contacts', v ? props.unblockedContacts : []);
  }
</script>

<template>
  <div :class="$style.shareToolbar">
    <div :class="$style.block">
      <ui3n-checkbox
        :size="isMobileFormFactor ? 20 : 16"
        :model-value="markedContacts?.length === totalContacts"
        :indeterminate="markedContacts?.length > 0 && markedContacts?.length < totalContacts"
        @update:model-value="onUpdate"
      >
        <span>{{ t('contacts.selected', { number: markedContacts?.length }) }}</span>
      </ui3n-checkbox>
    </div>

    <div :class="$style.block">
      <ui3n-button
        type="secondary"
        @click="() => emits('cancel')"
      >
        {{ t('app.btn.cancel') }}
      </ui3n-button>

      <ui3n-button
        :disabled="!markedContacts?.length"
        @click="emits('share')"
      >
        {{ t('app.btn.share') }}
      </ui3n-button>
    </div>
  </div>
</template>

<style lang="scss" module>
  .shareToolbar {
    display: flex;
    width: 100%;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-s) var(--spacing-m) var(--spacing-m) var(--spacing-m);
  }

  .block {
    --ui3n-checkbox-text-weight: 600;

    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-s);
  }
</style>
