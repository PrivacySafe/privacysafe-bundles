<!--
 Copyright (C) 2025 3NSoft Inc.

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
  import { computed, ref, useTemplateRef } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import isEmpty from 'lodash/isEmpty';
  import size from 'lodash/size';
  import { useSwipe, type UseSwipeDirection } from '@vueuse/core';
  import { useAppsStore } from '@/common/store/apps.store';
  import AppLauncher from '@/mobile/components/app-launcher.vue';

  const { t } = useI18n();

  const appsStore = useAppsStore();
  const { appLaunchers } = storeToRefs(appsStore);

  const ITEMS_PER_SCREEN = 8;
  const target = useTemplateRef('container');
  const currentPage = ref(0);
  const transitionName = ref('slide-next');

  const totalPages = computed(() => Math.ceil(size(appLaunchers.value) / ITEMS_PER_SCREEN));
  const currentScreenItems = computed(() => {
    const start = currentPage.value * ITEMS_PER_SCREEN;
    return (appLaunchers.value || [])
      .sort((a, b) => (a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1))
      .slice(start, start + ITEMS_PER_SCREEN);
  });

  const { isSwiping } = useSwipe(target, {
    passive: false,
    onSwipeEnd(e: TouchEvent, direction: UseSwipeDirection) {
      const dir = direction === 'left' ? 'next' : direction === 'right' ? 'prev' : '-';
      if (dir === '-') {
        return;
      }

      if (direction === 'left' && currentPage.value < totalPages.value - 1) {
        transitionName.value = 'slide-next';
        currentPage.value++;
      } else if (direction === 'right' && currentPage.value > 0) {
        transitionName.value = 'slide-prev';
        currentPage.value--;
      }
    },
  });
</script>

<template>
  <section :class="$style.myApps">
    <div
      v-if="isEmpty(appLaunchers)"
      :class="$style.installing"
    >
      {{ t('install.process') }} ...
    </div>

    <template v-else>
      <div :class="$style.body">
        <div
          ref="container"
          :class="$style.sliderContainer"
        >
          <Transition :name="transitionName">
            <div
              :key="currentPage"
              :class="$style.apps"
            >
              <template
                v-for="launcher in currentScreenItems"
                :key="`${launcher.appId}-${launcher.version}`"
              >
                <div :class="$style.appWrapper">
                  <app-launcher
                    :launcher="launcher"
                    :lock="isSwiping"
                  />
                </div>
              </template>
            </div>
          </Transition>
        </div>

        <div
          v-if="totalPages > 1"
          :class="$style.pagination"
        >
          <span
            v-for="page in totalPages"
            :key="page"
            :class="[$style.dot, currentPage === page - 1 && $style.active]"
          />
        </div>
      </div>
    </template>
  </section>
</template>

<style lang="scss" module>
  .myApps {
    position: relative;
    width: 100%;
    height: 100%;
    padding: var(--spacing-m);
  }

  .installing {
    position: absolute;
    top: var(--spacing-m);
    left: var(--spacing-m);
    width: calc(100% - var(--spacing-m) * 2);
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: var(--font-16);
    font-weight: 500;
    line-height: var(--spacing-ml);
    color: var(--color-text-block-primary-default);
    text-align: center;
  }

  .body {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .sliderContainer {
    position: relative;
    width: 100%;
    height: calc(100% - 48px);
    touch-action: pan-y;
    user-select: none;
  }

  .apps {
    display: grid;
    height: 100%;
    width: 100%;
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: repeat(4, 1fr);
    gap: var(--spacing-s);
  }

  .appWrapper {
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden;
  }

  .pagination {
    position: relative;
    width: 100%;
    height: 48px;
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-xs);

    .dot {
      position: relative;
      width: var(--spacing-s);
      height: var(--spacing-s);
      border-radius: 50%;
      background-color: var(--color-icon-control-secondary-default);
      transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);

      &.active {
        background: var(--color-icon-control-accent-default);
        transform: scale(1.4);
      }
    }
  }

  .slide-next-enter-active,
  .slide-next-leave-active,
  .slide-prev-enter-active,
  .slide-prev-leave-active {
    transition:
      transform 0.4s cubic-bezier(0.25, 0.1, 0.25, 1),
      opacity 0.4s;
  }

  .slide-next-enter-from {
    transform: translateX(100%);
    opacity: 0;
  }
  .slide-next-leave-to {
    transform: translateX(-100%);
    opacity: 0;
  }

  .slide-prev-enter-from {
    transform: translateX(-100%);
    opacity: 0;
  }
  .slide-prev-leave-to {
    transform: translateX(100%);
    opacity: 0;
  }
</style>
