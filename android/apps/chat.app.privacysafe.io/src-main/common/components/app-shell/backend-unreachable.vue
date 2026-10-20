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
<!--
 Shown when the window is up but its background component is not answering.

 The counterpart of the pre-mount screen in
 common/services/startup-failure-screen.ts, for the case where the failure is
 found by the first real call rather than by the connect: the app is mounted,
 and everything in it is about to do nothing.

 Retry asks before it acts. A bare location.reload() was what this button used
 to do, and on 2026-09-11 it was pressed against a component frozen twenty
 minutes earlier: the window came back, connected to the very same process (the
 platform has no way to restart a background component, and nothing closes one
 that does not close itself), and failed again - having thrown away a window
 that at least still had the chat list on screen. So the reload now happens only
 when a ping says there is something to reload into, and when there is not, the
 screen says so instead of pretending.
-->
<script lang="ts" setup>
  import { computed, ref } from 'vue';
  import { storeToRefs } from 'pinia';
  import { useI18n } from 'vue-i18n';
  import { Ui3nButton } from '@v1nt1248/3nclient-lib';
  import { useAppStore } from '@main/common/store/app.store';
  import {
    describeStartingStatus,
    probeBackend,
    type BackendVerdict,
  } from '@main/common/services/backend-availability';

  const { t } = useI18n();
  const { backendState } = storeToRefs(useAppStore());

  /** True while a probe is in flight, which takes up to 22 seconds. */
  const probing = ref(false);
  /** What the last probe said, when one was made from this screen. */
  const lastProbe = ref<BackendVerdict | undefined>(undefined);

  const isShown = computed(() => (
    (backendState.value === 'unreachable') || (backendState.value === 'failed')
  ));

  const title = computed(() => (
    ((backendState.value === 'failed') || (lastProbe.value?.kind === 'failed'))
      ? t('app.startup.failedTitle')
      : t('app.startup.unreachableTitle')
  ));

  const text = computed(() => {
    const probe = lastProbe.value;
    if (!probe) {
      return t('app.startup.unreachableText');
    } else if (probe.kind === 'starting') {
      return t('app.startup.stillStarting', {
        stage: describeStartingStatus(probe.status),
      });
    } else if (probe.kind === 'failed') {
      return t('app.startup.failedText', { reason: probe.reason });
    } else {
      // 'unreachable', and 'ready' never stays on screen - it reloads.
      return t('app.startup.stillUnreachableText');
    }
  });

  /**
   * Asks the component whether it is there, and reloads only if it is.
   *
   * A reload is still the right answer to a component that answers again: the
   * window's service callers are bound to their connection for good and cannot
   * reconnect, so nothing short of a fresh bootstrap picks up where this window
   * left off.
   */
  async function retry(): Promise<void> {
    if (probing.value) {
      return;
    }
    probing.value = true;
    try {
      const verdict = await probeBackend();
      lastProbe.value = verdict;
      if (verdict.kind === 'ready') {
        location.reload();
      }
    } finally {
      probing.value = false;
    }
  }

  /**
   * Closes this window only - which is all a component can do for itself. The
   * frozen background component outlives it, so the text above is what tells
   * the user what actually helps.
   */
  function closeWindow(): void {
    w3n.closeSelf!();
  }
</script>

<template>
  <div
    v-if="isShown"
    :class="$style.overlay"
  >
    <div :class="$style.box">
      <div :class="$style.title">
        {{ title }}
      </div>
      <div :class="$style.text">
        {{ text }}
      </div>
      <div :class="$style.actions">
        <ui3n-button
          :disabled="probing"
          @click="retry"
        >
          {{ probing ? t('app.startup.checking') : t('app.startup.retry') }}
        </ui3n-button>
        <ui3n-button
          type="secondary"
          @click="closeWindow"
        >
          {{ t('app.startup.closeWindow') }}
        </ui3n-button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 100;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: var(--color-bg-block-primary-default);
  }

  .box {
    width: 360px;
    max-width: 90%;
    text-align: center;
  }

  .title {
    font-size: var(--font-16);
    font-weight: 600;
    color: var(--color-text-block-primary-default);
    margin-bottom: var(--spacing-s);
  }

  .text {
    font-size: var(--font-13);
    color: var(--color-text-block-secondary-default);
    margin-bottom: var(--spacing-m);
  }

  .actions {
    display: flex;
    justify-content: center;
    gap: var(--spacing-s);
  }
</style>
