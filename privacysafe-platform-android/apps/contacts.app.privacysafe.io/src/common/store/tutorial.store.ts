/*
 Copyright (C) 2026 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but WITHOUT
 ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/
import { inject, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { defineStore } from 'pinia';
import { type AllowedButtons, driver, type Driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import { TUTORIAL_DATA_KEY } from '@main/common/constants';
import { DEFAULT_MOBILE_TUTORIAL_STEPS, DEFAULT_DESKTOP_TUTORIAL_STEPS } from '@main/common/data/tutorial';
import { appContactsSrvProxy } from '@main/common/services/services-provider';
import type { TutorialState, TutorialStep, TutorialStepData } from '@main/types';

export const useTutorialStore = defineStore('tutorial', () => {
  const { t } = useI18n();
  const isMobileMode = inject<boolean>('isMobileMode');

  const tutorialKey = isMobileMode ? `${TUTORIAL_DATA_KEY}-mobile` : TUTORIAL_DATA_KEY;
  const defaultSteps = isMobileMode ? DEFAULT_MOBILE_TUTORIAL_STEPS : DEFAULT_DESKTOP_TUTORIAL_STEPS;

  const activeDriver = ref<Driver | null>(null);

  const remainingSteps = ref<TutorialStep[]>([]);
  const isActive = ref(false);

  let isLoaded = false;
  let loadPromise: Promise<void> | undefined;

  function rehydrateSteps(steps: TutorialState['remainingSteps']): TutorialStep[] {
    return steps.map(step => {
      const def = defaultSteps.find(d => d.elQuery === step.elQuery);
      return { ...step, onNextAction: def?.onNextAction };
    });
  }

  function toStepData(step: TutorialStep): TutorialStepData {
    return {
      elQuery: step.elQuery,
      text: step.text,
      side: step.side,
      alignment: step.alignment,
      isRound: step.isRound,
    };
  }

  function loadState(): Promise<void> {
    if (isLoaded) {
      return Promise.resolve();
    }

    loadPromise ??= (async () => {
      try {
        const state = await appContactsSrvProxy.getTutorialState(tutorialKey);
        if (state) {
          remainingSteps.value = rehydrateSteps(state.remainingSteps);
          isActive.value = state.isActive;
        } else {
          remainingSteps.value = defaultSteps;
          isActive.value = true;
        }
      } catch (err) {
        isActive.value = false;
        remainingSteps.value = [];
        console.error('Could not load the tutorial state. ', err);
      } finally {
        isLoaded = true;
      }
    })();

    return loadPromise;
  }

  async function persistState(): Promise<void> {
    try {
      await appContactsSrvProxy.saveTutorialState(tutorialKey, {
        isActive: isActive.value,
        remainingSteps: remainingSteps.value.map(toStepData),
      });
    } catch (err) {
      console.error('Could not save the tutorial state. ', err);
    }
  }

  function completeStep(elQuery: string): Promise<void> {
    remainingSteps.value = remainingSteps.value.filter(s => s.elQuery !== elQuery);

    if (remainingSteps.value.length === 0) {
      isActive.value = false;
    }

    return persistState();
  }

  function stopAndClearTutorial(): Promise<void> {
    remainingSteps.value = [];
    isActive.value = false;
    return persistState();
  }

  async function resetTutorial(): Promise<void> {
    remainingSteps.value = defaultSteps;
    isActive.value = true;
    await persistState();
  }

  async function checkAndRunSteps(): Promise<void> {
    await loadState();

    if (!isActive.value || remainingSteps.value.length === 0) {
      return;
    }

    if (activeDriver.value) {
      activeDriver.value.destroy();
      activeDriver.value = null;
    }

    const currentStep = remainingSteps.value.find(step => document.querySelector(step.elQuery));

    if (currentStep) {
      const el = document.querySelector(currentStep.elQuery);
      if (!el) {
        return;
      }

      const isLastStep = remainingSteps.value.length === 1;

      const baseConfig = {
        animate: true,
        allowClose: true,
        overlayColor: 'rgba(0, 0, 0, 0.5)',
        showButtons: ['next', 'close'] as AllowedButtons[],
        stagePadding: 5,
        disableActiveInteraction: true,
        nextBtnText: isLastStep ? 'Done' : 'Next',
        onNextClick: async () => {
          await completeStep(currentStep.elQuery);

          if (currentStep.onNextAction) {
            await currentStep.onNextAction();
          }

          if (activeDriver.value) {
            activeDriver.value.destroy();
            activeDriver.value = null;
          }

          if (!isLastStep) {
            setTimeout(() => void checkAndRunSteps(), 100);
          } else {
            await stopAndClearTutorial();
          }
        },
        onCloseClick: () => {
          void stopAndClearTutorial();
          if (activeDriver.value) {
            activeDriver.value.destroy();
            activeDriver.value = null;
          }
        },
        overlayClickBehavior: () => {
          void stopAndClearTutorial();
          if (activeDriver.value) {
            activeDriver.value.destroy();
            activeDriver.value = null;
          }
        },
      };

      activeDriver.value = driver(baseConfig);

      if (currentStep.isRound) {
        const rect = el.getBoundingClientRect();
        const circleRadius = rect.width / 2 + 5;
        activeDriver.value.setConfig({
          ...baseConfig,
          stageRadius: circleRadius,
        });
      } else {
        activeDriver.value.setConfig({
          ...baseConfig,
          stageRadius: 4,
        });
      }

      const driveStep: DriveStep = {
        element: currentStep.elQuery,
        disableActiveInteraction: true,
        popover: {
          description: t(currentStep.text),
          side: currentStep.side || 'top',
          align: currentStep.alignment || 'start',
          showButtons: ['next', 'close'] as AllowedButtons[],
        },
      };

      activeDriver.value.highlight(driveStep);

      const handleElementClick = (): void => {
        activeDriver.value?.destroy();
        void completeStep(currentStep.elQuery);
      };

      el.addEventListener('click', handleElementClick, { once: true });
    }
  }

  return {
    remainingSteps,
    isActive,
    checkAndRunSteps,
    resetTutorial,
  };
});
