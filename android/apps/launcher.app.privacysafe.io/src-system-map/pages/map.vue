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
  import { nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Ui3nRadio, Ui3nRadioGroup, Ui3nSlider, Ui3nSwitch } from '@v1nt1248/3nclient-lib';
  import { fetchData, filterForFormFactor } from '@sys-map/utils/apps-data';
  import { svgWithApps, toDataForDiagram } from '@sys-map/utils/d2-diagrams';

  const { t } = useI18n();

  let appsData: AppData[] = [];

  const formFactor = ref<'desktop' | 'phone'>('desktop');
  const mapSvg = ref<string>('');
  const renderDirection = ref<'right' | 'down'>('right');
  const sketchTheme = ref(false);
  const zoomPercent = ref(100);
  const elemWithMap = useTemplateRef<HTMLDivElement>('map-element');

  function changeRenderingDirection() {
    renderDirection.value = renderDirection.value === 'right' ? 'down' : 'right';
    nextTick(renderSVG);
  }

  function toggleSketch() {
    sketchTheme.value = !sketchTheme.value;
    nextTick(renderSVG);
  }

  const applyingFF = watch(
    () => formFactor.value,
    (val, oldVal) => {
      if (val !== oldVal) {
        nextTick(renderSVG);
      }
    },
  );

  const applyingZoom = watch(
    () => zoomPercent.value,
    (val, oldVal) => {
      if (val !== oldVal) {
        elemWithMap.value!.setAttribute(
          'style',
          `transform: scale(${Math.floor(val)}%); transform-origin: left top;`,
        );
      }
    },
  );

  async function renderSVG(applyFF = true): Promise<void> {
    const filteredApps = applyFF ? filterForFormFactor(formFactor.value, appsData) : appsData;

    mapSvg.value = await svgWithApps(toDataForDiagram(filteredApps), {
      direction: renderDirection.value,
      theme: sketchTheme.value
        ? {
            sketch: true,
            themeID: 4,
            darkThemeID: 200,
          }
        : undefined,
    });
  }

  onMounted(async () => {
    const apps = await fetchData(async apps => {
      appsData = apps;
      await renderSVG(false);
    });

    appsData = apps;
    await renderSVG();
  });

  onBeforeUnmount(() => {
    applyingZoom.stop();
    applyingFF.stop();
  });
</script>

<template>
  <!-- eslint-disable vue/no-v-html -->
  <div :class="$style.map">
    <div :class="$style.controls">
      <div :class="[$style.controlBlock, $style.zoom]">
        <h4 :class="$style.controlBlockLabel">{{ t('system.map.control.zoom') }}:</h4>

        <ui3n-slider
          v-model="zoomPercent"
          :min="30"
          :max="300"
          :transform-value-method="(val: number) => `${val}%`"
        />
      </div>

      <div :class="$style.controlBlock">
        <h4 :class="$style.controlBlockLabel">{{ t('system.map.control.formFactor.label') }}:</h4>

        <ui3n-radio-group
          v-model="formFactor"
          name="formFactor"
          direction="horizontal"
        >
          <ui3n-radio
            size="32"
            :checked-value="'desktop'"
          >
            {{ t('system.map.control.formFactor.desktop') }}
          </ui3n-radio>

          <ui3n-radio
            size="32"
            :checked-value="'phone'"
          >
            {{ t('system.map.control.formFactor.phone') }}
          </ui3n-radio>
        </ui3n-radio-group>
      </div>

      <div :class="$style.controlBlock">
        <h4 :class="$style.controlBlockLabel">{{ t('system.map.control.direction') }}:</h4>

        <ui3n-switch
          size="16"
          :model-value="renderDirection === 'down'"
          @change="changeRenderingDirection"
        />
      </div>

      <div :class="$style.controlBlock">
        <h4 :class="$style.controlBlockLabel">{{ t('system.map.control.sketch') }}:</h4>

        <ui3n-switch
          size="16"
          :model-value="sketchTheme"
          @change="toggleSketch"
        />
      </div>
    </div>

    <div :class="$style.mapContainer">
      <div
        ref="map-element"
        :class="$style.schema"
        v-html="mapSvg"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@/common/assets/styles/_mixins' as mixins;

  .map {
    --controls-height: 64px;

    position: fixed;
    left: 0;
    top: 0;
    width: 100%;
    height: 100dvh;
    background-color: var(--color-bg-block-primary-default);
    font-family: Manrope, sans-serif;
  }

  .controls {
    position: relative;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    width: 100%;
    height: var(--controls-height);
    padding: 0 var(--spacing-m);
    column-gap: var(--spacing-s);
  }

  .controlBlock {
    display: flex;
    height: 48px;
    justify-content: center;
    align-items: center;
    padding: 0 var(--spacing-s);
    column-gap: var(--spacing-s);
    border-radius: var(--spacing-xs);
    border: 1px solid var(--color-border-control-secondary-default);
  }

  .controlBlockLabel {
    font-size: var(--font-16);
    padding: 0;
    margin: 0;
  }

  .zoom {
    width: 150px;
  }

  .mapContainer {
    overflow: auto;
    position: relative;
    width: calc(100% - var(--spacing-s));
    height: calc(100% - var(--controls-height) - var(--spacing-s));
    padding: var(--spacing-s);
  }

  .schema {
    position: relative;
    min-width: 100%;
    min-height: 100%;
  }

  ::-webkit-scrollbar-button {
    background-image: url('');
    background-repeat: no-repeat;
    width: var(--spacing-xs);
    height: 0;
  }

  ::-webkit-scrollbar-track {
    background-color: var(--s-default-outline-focused);
  }

  ::-webkit-scrollbar-thumb {
    border-radius: 2px;
    height: 50px;
    background-color: var(--default-fill-pressed);
  }

  ::-webkit-scrollbar-thumb:hover {
    background-color: var(--t-default-fill-default);
  }

  ::-webkit-resizer {
    background-image: url('');
    background-repeat: no-repeat;
    width: var(--spacing-xs);
    height: 0;
  }

  ::-webkit-scrollbar {
    width: 5px;
    height: 5px;
  }
</style>
