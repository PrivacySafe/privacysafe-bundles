<script setup lang="ts">
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import type { AppInfo } from '@/common/types';
  import { getAppTags } from '@/common/utils/app-tags';
  import AppTags from '@/common/components/app-tags.vue';

  const props = defineProps<{
    appInfo: AppInfo;
    expandable?: boolean;
  }>();

  const { t } = useI18n();
  const tags = computed(() => getAppTags(props.appInfo.tags));
  const metadataFields = ['publisher', 'website', 'contact', 'policy', 'terms', 'license', 'source'] as const;
  const metadata = computed(() =>
    metadataFields.map(key => ({ key, value: props.appInfo[key] })).filter(({ value }) => !!value?.trim()),
  );
</script>

<template>
  <component
    :is="expandable ? 'details' : 'div'"
    v-if="metadata.length > 0 || tags.length > 0"
    :class="$style.metadata"
  >
    <summary
      v-if="expandable"
      :class="$style.summary"
    >
      {{ t('app.info.details') }}
    </summary>

    <dl :class="$style.fields">
      <div
        v-if="tags.length > 0"
        :class="$style.field"
      >
        <dt :class="$style.label">
          {{ t('app.info.tags', 'Tags') }}
        </dt>
        <dd :class="$style.value">
          <app-tags :tags="tags" />
        </dd>
      </div>

      <div
        v-for="item in metadata"
        :key="item.key"
        :class="$style.field"
      >
        <dt :class="$style.label">
          {{ t(`app.info.${item.key}`) }}
        </dt>
        <dd :class="$style.value">
          {{ item.value }}
        </dd>
      </div>
    </dl>
  </component>
</template>

<style lang="scss" module>
  .metadata {
    container-type: inline-size;
    width: 100%;
    min-width: 0;
    font-size: var(--font-12);
    line-height: var(--font-18);
    text-align: left;
    color: var(--color-text-block-primary-default);
  }

  .summary {
    width: fit-content;
    padding: var(--spacing-s) 0;
    color: var(--color-text-block-accent-default);
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--color-text-block-accent-default);
      outline-offset: 2px;
    }
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-s);
    margin: 0;
    padding: var(--spacing-s) 0;
  }

  .field {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    gap: var(--spacing-s);
  }

  .label {
    min-width: 0;
    overflow-wrap: anywhere;
    font-weight: 600;
    color: var(--color-text-block-secondary-default);
  }

  .value {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    user-select: text;
  }

  @media (max-width: 480px) {
    .field {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--spacing-xs);
    }
  }

  @container (max-width: 480px) {
    .field {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--spacing-xs);
    }
  }
</style>
