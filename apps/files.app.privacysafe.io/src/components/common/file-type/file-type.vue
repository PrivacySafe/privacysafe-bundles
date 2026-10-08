<script setup lang="ts">
  import { computed } from 'vue';
  import get from 'lodash/get';
  import { Ui3nChip } from '@v1nt1248/3nclient-lib';
  import { FILE_TYPE_COLOR_DEFAULT, FILE_TYPE_COLORS } from './constants';

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
  .fileType {
    border-radius: 3px;

    div:last-child {
      line-height: 14px !important;
    }
  }
</style>
