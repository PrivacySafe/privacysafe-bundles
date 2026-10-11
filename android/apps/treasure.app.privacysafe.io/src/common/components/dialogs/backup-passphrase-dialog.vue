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
<script lang="ts" setup>
  import { computed, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    Ui3nDialog,
    Ui3nIcon,
    Ui3nInput,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';

  /** Shortest passphrase worth calling one. Empty means "do not encrypt". */
  const MIN_LENGTH = 8;

  const props = defineProps<{
    /**
     * `create` asks for a new passphrase and can be left empty, which produces
     * an unencrypted archive. `open` asks for the one an archive was made with.
     */
    mode: 'create' | 'open';
    /** Set when the previous attempt was refused by the archive. */
    wrongPassphrase?: boolean;
    dialogProps?: Ui3nDialogComponentProps<string>;
  }>();

  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: string }): void;
  }>();

  const { t } = useI18n();

  const passphrase = ref('');
  const repeated = ref('');
  const isRevealed = ref(false);

  const fieldType = computed(() => (isRevealed.value ? 'text' : 'password'));

  const isMismatched = computed(() => !!repeated.value && passphrase.value !== repeated.value);

  const isTooShort = computed(
    () => props.mode === 'create' && !!passphrase.value && passphrase.value.length < MIN_LENGTH,
  );

  const isValid = computed(() => {
    if (props.mode === 'open') {
      return !!passphrase.value;
    }

    if (!passphrase.value && !repeated.value) {
      return true;
    }

    return !isTooShort.value && passphrase.value === repeated.value;
  });

  function handleAction(e: { event: Ui3nDialogEvent }) {
    if (e.event === 'confirm') {
      emits('action', { event: 'confirm', data: passphrase.value });
      return;
    }

    emits('action', e);
  }
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    :is-valid="isValid"
    @action="handleAction"
  >
    <template #body>
      <div :class="$style.backupPassphraseDialog">
        <p :class="$style.hint">
          {{ mode === 'create' ? t('backup.passphrase.createHint') : t('backup.passphrase.openHint') }}
        </p>

        <ui3n-input
          v-model="passphrase"
          :type="fieldType"
          autofocus
          :label="t('backup.passphrase.label')"
          :placeholder="mode === 'create' ? t('backup.passphrase.placeholder') : ''"
        >
          <template #append-icon>
            <ui3n-icon
              :icon="isRevealed ? 'eye-off-outline' : 'eye-outline'"
              :title="isRevealed ? t('backup.passphrase.hide') : t('backup.passphrase.show')"
              width="16"
              height="16"
              color="var(--color-icon-control-secondary-default)"
              :class="$style.reveal"
              @click="isRevealed = !isRevealed"
            />
          </template>
        </ui3n-input>

        <ui3n-input
          v-if="mode === 'create'"
          v-model="repeated"
          :type="fieldType"
          :label="t('backup.passphrase.repeatLabel')"
        />

        <span
          v-if="wrongPassphrase"
          :class="$style.error"
        >
          {{ t('backup.passphrase.wrong') }}
        </span>

        <span
          v-else-if="isTooShort"
          :class="$style.error"
        >
          {{ t('backup.passphrase.tooShort', { count: MIN_LENGTH }) }}
        </span>

        <span
          v-else-if="isMismatched"
          :class="$style.error"
        >
          {{ t('backup.passphrase.mismatch') }}
        </span>

        <span
          v-else-if="mode === 'create'"
          :class="[$style.warning, !passphrase && $style.muted]"
        >
          {{ passphrase ? t('backup.passphrase.noRecovery') : t('backup.passphrase.optional') }}
        </span>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .backupPassphraseDialog {
    position: relative;
    display: flex;
    flex-direction: column;
    row-gap: var(--spacing-s);
    padding: var(--spacing-ml) var(--spacing-m) var(--spacing-s);
    font-size: var(--font-14);
    color: var(--color-text-block-primary-default);
  }

  .hint {
    margin: 0;
    font-size: var(--font-13);
    color: var(--color-text-block-secondary-default);
  }

  .reveal {
    cursor: pointer;

    &:hover {
      color: var(--color-icon-control-accent-default);
    }
  }

  .error {
    font-size: var(--font-12);
    color: var(--error-content-default);
  }

  .warning {
    font-size: var(--font-12);
    color: var(--warning-content-default);
  }

  .muted {
    color: var(--color-text-block-secondary-default);
  }
</style>
