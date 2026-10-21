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
<script setup lang="ts">
import { computed } from 'vue';
import get from 'lodash/get';
import { Ui3nChip } from '@v1nt1248/3nclient-lib';
import { FILE_TYPE_COLOR_DEFAULT, FILE_TYPE_COLORS } from '@main/common/constants';

const props = defineProps<{
  fileType: string;
}>();

const type = computed(() => props.fileType ? props.fileType.toUpperCase() : '');
const chipColors = computed(() => get(FILE_TYPE_COLORS, props.fileType, FILE_TYPE_COLOR_DEFAULT));
</script>

<template>
  <ui3n-chip
    :class="$style.fileType"
    :round="false"
    height="14"
    max-width="80"
    :color="chipColors.bg"
    :text-color="chipColors.color"
    text-size="9"
  >
    {{ type }}
  </ui3n-chip>
</template>

<style lang="scss" module>
.chatAttachmentType {
  border-radius: 3px;

  div:last-child {
    line-height: 14px !important;
  }
}
</style>

