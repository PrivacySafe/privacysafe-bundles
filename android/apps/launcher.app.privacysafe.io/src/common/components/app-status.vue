<script setup lang="ts">
  import { computed } from 'vue';
  import { getAppStatus } from '@/common/utils/app-tags';

  const props = withDefaults(
    defineProps<{
      tags?: string[];
      fontSize?: number;
    }>(),
    {
      fontSize: 12,
    },
  );

  const statusLabels = {
    stable: 'Stable',
    beta: 'Beta',
    nightly: 'Nightly',
  };
  const status = computed(() => getAppStatus(props.tags));
  const fontSizeCss = computed(() => `${props.fontSize}px`);
</script>

<template>
  <span
    v-if="status"
    :class="[$style.status, $style[status]]"
  >
    {{ statusLabels[status] }}
  </span>
</template>

<style lang="scss" module>
  .status {
    flex-shrink: 0;
    font-size: v-bind(fontSizeCss);
    font-weight: 500;
    line-height: 1.2;
    position: absolute;
    top: var(--spacing-m);
    right: var(--spacing-m);
  }

  .stable {
    color: #3771c8;
  }

  .beta {
    color: #2ca089;
  }

  .nightly {
    color: #ff6428;
  }
</style>
