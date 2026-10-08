<script lang="ts" setup>
  import { inject } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { VUEBUS_KEY, VueBusPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { Ui3nDropFiles, Ui3nInputFile } from '@v1nt1248/3nclient-lib';
  import type { AppGlobalEvents } from '@shared/types';
  import { useFsStore } from '@/store';

  const props = defineProps<{
    fsId: string;
    path: string;
    isEmptyFolderMode?: boolean;
    disabled?: boolean;
  }>();
  const emits = defineEmits<{
    (event: 'loading', value: boolean): void;
  }>();

  const { t } = useI18n();
  const bus = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;

  const { saveFileBaseOnOsFileSystemFile } = useFsStore();

  async function onFilesSelect(value: File[] | FileList) {
    try {
      emits('loading', true);
      const files = [...value] as File[];
      for (const file of files) {
        await saveFileBaseOnOsFileSystemFile({
          fsId: props.fsId,
          uploadedFile: file,
          folderPath: props.path,
          withThumbnail: true,
        });
      }
      bus.$emitter.emit('upload:file', { fsId: props.fsId, fullPath: props.path });
    } finally {
      emits('loading', false);
    }
  }
</script>

<template>
  <div :class="[$style.osFilesDropArea, disabled && $style.disabled]">
    <ui3n-drop-files
      :class="!isEmptyFolderMode && $style.withoutIcon"
      title=""
      permanent-display
      @select="onFilesSelect"
    >
      <template
        v-if="isEmptyFolderMode"
        #additional-text
      >
        <div :class="$style.noDataText">
          <span>{{ t('fs.table.folder.empty_text') }}</span>
          &nbsp;
          <ui3n-input-file
            multiple
            :button-text="t('app.upload_file')"
            :disabled="disabled"
            @update:model-value="onFilesSelect"
          />
        </div>
      </template>
    </ui3n-drop-files>
  </div>
</template>

<style lang="scss" module>
  .osFilesDropArea {
    position: absolute;
    inset: 2px;
    display: flex;
    justify-content: center;
    align-items: center;

    &.disabled {
      pointer-events: none;
      cursor: not-allowed;
      opacity: 0.7;
    }
  }

  .withoutIcon {
    div:first-child {
      div {
        display: none;
      }
    }
  }

  .noDataText {
    font-size: var(--font-12);
    font-weight: 500;
    line-height: var(--font-16);
    color: var(--color-text-control-secondary-default);
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--space-xs);

    span {
      display: inline-block;
      user-select: none;
    }
  }
</style>
