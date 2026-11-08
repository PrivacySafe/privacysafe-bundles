<script setup lang="ts">
  import { computed } from 'vue';
  import { getAppTags } from '@/common/utils/app-tags';

  const props = withDefaults(
    defineProps<{
      tags?: string[];
      fontSize?: number;
    }>(),
    {
      fontSize: 12,
    },
  );

  const displayedTags = computed(() => getAppTags(props.tags));
  const fontSizeCss = computed(() => `${props.fontSize}px`);
</script>

<template>
  <ul
    v-if="displayedTags.length > 0"
    :class="$style.tags"
  >
    <li
      v-for="tag in displayedTags"
      :key="tag"
      :class="$style.tag"
    >
      {{ tag }}
    </li>
  </ul>
</template>

<style lang="scss" module>
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-xs);
    min-width: 0;
    max-width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tag {
    min-width: 0;
    max-width: 100%;
    padding: 4px 8px;
    border-radius: 4px;
    background-color: #eff0f1;
    color: #3771c8;
    font-size: v-bind(fontSizeCss);
    font-weight: 500;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
</style>
