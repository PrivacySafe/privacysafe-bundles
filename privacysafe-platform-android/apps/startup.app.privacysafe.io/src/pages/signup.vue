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
  import { useRoute, useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { Ui3nButton } from '@v1nt1248/3nclient-lib';
  import { APP_ROUTES } from '@/constants';
  import SignupStep1 from '@/components/signup-step-1.vue';
  import SignupStep2 from '@/components/signup-step-2.vue';
  import SignupStep3 from '@/components/signup-step-3.vue';
  import SignupStep4 from '@/components/signup-step-4.vue';
  import ProgressPage from '@/components/progress.vue';

  const { t } = useI18n();
  const route = useRoute();
  const router = useRouter();

  const step = ref((route.query.step as string) ? Number(route.query.step) : 1);
  const stepTitleTxt = ref('');

  function changeStep(payload: { step: number; query?: Record<string, string> }) {
    stepTitleTxt.value = '';

    if (payload.step === 0) {
      return router.push({ name: APP_ROUTES.SIGNIN });
    }

    step.value = payload.step;
    return router.push({
      query: {
        step: payload.step,
        ...(payload.query && { ...payload.query }),
      },
    });
  }

  function setStepTitleTxt(payload: { title: string }) {
    stepTitleTxt.value = payload.title;
  }
</script>

<template>
  <section :class="$style.signup">
    <progress-page v-if="step === 5" />

    <template v-else>
      <h3 :class="$style.title">
        {{ stepTitleTxt }}
        <ui3n-button
          type="icon"
          size="small"
          color="var(--color-bg-block-primary-default)"
          icon="round-arrow-back"
          icon-size="20"
          icon-color="var(--color-icon-button-secondary-default)"
          :class="$style.backBtn"
          @click="changeStep({ step: step - 1 })"
        />
      </h3>

      <div :class="$style.body">
        <signup-step1
          v-if="step === 1"
          @change:step="changeStep"
          @change:step-title="setStepTitleTxt"
        />

        <signup-step2
          v-if="step === 2"
          @change:step="changeStep"
          @change:step-title="setStepTitleTxt"
        />

        <signup-step3
          v-if="step === 3"
          @change:step="changeStep"
          @change:step-title="setStepTitleTxt"
        />

        <signup-step4
          v-if="step === 4"
          @change:step="changeStep"
          @change:step-title="setStepTitleTxt"
        />
      </div>
    </template>
  </section>
</template>

<style lang="scss" module>
  .signup {
    position: relative;
    width: 100%;
    height: 100%;
    padding: var(--spacing-m) var(--spacing-m) var(--spacing-xxl) var(--spacing-m);

    .title {
      position: relative;
      width: 100%;
      font-size: var(--font-20);
      font-weight: 500;
      line-height: var(--font-24);
      color: var(--color-text-block-primary-default);
      text-align: center;
      margin-block-start: 0;
      margin-block-end: var(--spacing-ml);

      .backBtn {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 1;
      }

      margin-bottom: var(--spacing-xl);
    }

    .stepLine {
      position: relative;
      width: 100%;
      margin-bottom: var(--spacing-ml);
    }

    .body {
      position: relative;
      width: 100%;
      height: calc(100% - 64px);
    }
  }
</style>
