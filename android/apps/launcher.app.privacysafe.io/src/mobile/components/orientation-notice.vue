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
  import { useI18n } from 'vue-i18n';
  import { Ui3nIcon } from '@v1nt1248/3nclient-lib';

  const { t } = useI18n();
</script>

<template>
  <!--
    The phone layout is built for portrait only, so a phone turned sideways gets
    this instead of the interface. Two decisions worth keeping:

    Landscape is detected by a media query, not by a listener on
    `orientationchange` / `matchMedia`: state cannot then disagree with what is
    actually on screen, and there is no observer to tear down. (`v-ui3n-resize`
    would be the wrong tool anyway - its ResizeObserver is a module-level
    singleton, so a second use in the same window unhooks the first.)

    And it covers the interface rather than replacing it.
  -->
  <div :class="$style.orientationNotice">
    <ui3n-icon
      icon="round-rotate-right"
      size="48"
      color="var(--color-icon-block-accent-default)"
    />

    <div :class="$style.text">
      {{ t('app.orientation.rotateBack') }}
    </div>
  </div>
</template>

<style lang="scss" module>
  .orientationNotice {
    /*
    Above everything the app itself raises: attachment-viewer loaders sit at
    5500 and the notification mount point at 5000. The library's own toast
    layer (9999) stays above, which is fine - toasts are informational and
    dismiss themselves.
  */
    position: fixed;
    inset: 0;
    z-index: 6000;
    display: none;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    row-gap: var(--spacing-m);
    padding: var(--spacing-l);
    background-color: var(--color-bg-block-primary-default);
    text-align: center;
  }

  @media (orientation: landscape) {
    .orientationNotice {
      display: flex;
    }
  }

  .text {
    font-size: var(--font-16);
    font-weight: 500;
    line-height: 22px;
    color: var(--color-text-block-primary-default);
  }
</style>
