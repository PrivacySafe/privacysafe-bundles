<!--
 Copyright (C) 2024 3NSoft Inc.

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

<script lang="ts" setup></script>

<template>
  <div :class="$style.applicationView">
    <div :class="$style.main">
      <slot name="main" />
    </div>

    <slot name="other" />
  </div>
</template>

<style lang="scss" module>
  .applicationView {
    --action-block-width: 88px;

    position: relative;
    width: 100%;
    min-height: 92px;
    border-radius: var(--spacing-s);
    padding: var(--spacing-s) var(--spacing-m);
    background-color: var(--color-bg-control-secondary-default);
    margin-bottom: var(--spacing-s);
  }

  .main {
    position: relative;
    width: 100%;
    min-height: var(--spacing-l);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    gap: var(--spacing-s);
  }
</style>
