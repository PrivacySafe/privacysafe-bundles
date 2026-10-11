<script lang="ts" setup>
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { usePickerState } from '@picker/common/composables/usePickerState';
  import { Ui3nButton, Ui3nBreadcrumb, Ui3nBreadcrumbs } from '@v1nt1248/3nclient-lib';

  const emit = defineEmits<{ newFolder: [] }>();
  const { t } = useI18n();
  const picker = usePickerState();
  const segments = computed(() => picker.currentWindow.value.currentPath.split('/').filter(Boolean));

  function goToSegment(index: number) {
    void picker.navigateToFolder(segments.value.slice(0, index + 1).join('/'));
  }

  function goBack() {
    void picker.navigateToFolder(segments.value.slice(0, -1).join('/'));
  }
</script>

<template>
  <div :class="$style.breadcrumbPanel">
    <ui3n-button
      type="icon"
      icon="round-arrow-back"
      color="var(--color-bg-block-primary-default)"
      icon-color="var(--color-text-control-primary-default)"
      icon-size="25"
      square
      :class="$style.navButton"
      :disabled="!segments.length"
      @click="goBack"
    />

    <div :class="$style.crumbsHolder">
      <ui3n-breadcrumbs>
        <ui3n-breadcrumb
          v-for="(segment, index) in segments"
          :key="`${segment}-${index}`"
          :is-active="index < segments.length - 1"
          @click="goToSegment(index)"
        >
          {{ segment }}
        </ui3n-breadcrumb>
      </ui3n-breadcrumbs>
    </div>

    <ui3n-button
      icon="outline-folder"
      icon-position="left"
      :disabled="picker.isBusy.value || !picker.canWrite.value || picker.currentWindow.value.status !== 'ready'"
      :class="$style.newFolderButton"
      @click="emit('newFolder')"
    >
      {{ t('file_picker.button.new_folder') }}
    </ui3n-button>
  </div>
</template>

<style lang="scss" module>
  .breadcrumbPanel {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    color: var(--color-text-control-primary-default);
    border-bottom: 1px solid var(--color-border-block-primary-default);
  }
  .navButton {
    flex-shrink: 0;
    border: 1px solid var(--color-border-block-primary-default) !important;
  }

  .newFolderButton {
    flex-shrink: 0;
    white-space: nowrap;
  }

  .crumbsHolder {
    flex: 1;
    overflow: hidden;
    min-width: 0;
    font-size: var(--font-14);
  }
</style>
