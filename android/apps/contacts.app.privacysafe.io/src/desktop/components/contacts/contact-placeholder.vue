<!--
 Copyright (C) 2020 - 2024 3NSoft Inc.

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
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <div :class="$style.contactEmpty">
    <div :class="$style.image">
      <div :class="[$style.circle, $style.circle1]" />
      <div :class="[$style.circle, $style.circle2]" />
      <div :class="[$style.circle, $style.circle3]" />
    </div>
    <div :class="$style.text">
      {{ t('contact.placeholder') }}
    </div>
  </div>
</template>

<style lang="scss" module>
.contactEmpty {
  --circle-size-big: 132px;
  --circle-size-mid: 104px;
  --circle-size-small: 72px;

  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.image {
  position: relative;
  width: 220px;
  height: 220px;
  margin-bottom: var(--spacing-ml);
}

.text {
  text-align: center;
  font-size: var(--font-14);
  font-weight: 300;
  font-style: italic;
  color: var(--color-text-block-primary-default);
  user-select: none;
}

.circle {
  position: absolute;
  border-radius: 50%;
}

.circle1 {
  width: var(--circle-size-big);
  height: var(--circle-size-big);
  background-color: rgb(0, 144, 236, 0.16);
  left: 26%;
  top: 0;
}

.circle2 {
  width: var(--circle-size-mid);
  height: var(--circle-size-mid);
  background-color: rgb(0, 144, 236, 0.54);
  left: 8%;
  bottom: 24px;
}

.circle3 {
  width: var(--circle-size-small);
  height: var(--circle-size-small);
  background-color: rgb(0, 144, 236, 0.87);
  right: 25%;
  bottom: 0;
}
</style>
