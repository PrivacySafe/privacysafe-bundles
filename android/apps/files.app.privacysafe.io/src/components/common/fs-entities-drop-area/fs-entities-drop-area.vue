<script lang="ts" setup>
  import { computed } from 'vue';
  import { Ui3nIcon, type Nullable } from '@v1nt1248/3nclient-lib';

  const props = defineProps<{
    path: string;
    droppableEntity: Nullable<string>;
    disabled?: boolean;
  }>();
  const emits = defineEmits<{
    (event: 'dragend'): void;
    (event: 'dragenter', value: DragEvent): void;
    (event: 'dragover', value: DragEvent): void;
    (event: 'dragleave', value: DragEvent): void;
    (event: 'drop', value: DragEvent): void;
  }>();

  const pathValue = computed(() => props.path || '/');
</script>

<template>
  <div
    :class="[
      $style.fsEntitiesDropArea,
      disabled && $style.disabled,
      droppableEntity && droppableEntity === pathValue && $style.fsEntitiesDropAreaShow,
    ]"
    @dragend="emits('dragend')"
    @dragenter="emits('dragenter', $event)"
    @dragover="emits('dragover', $event)"
    @dragleave="emits('dragleave', $event)"
    @drop="emits('drop', $event)"
  >
    <ui3n-icon
      icon="round-system-update-alt"
      :width="48"
      :height="48"
      :rotate="-90"
      color="var(--color-icon-control-accent-default)"
    />
  </div>
</template>

<style lang="scss" module>
  .fsEntitiesDropArea {
    display: flex;
    width: 100%;
    height: 100%;
    justify-content: center;
    align-items: center;
    opacity: 0;
    transition: all 0.2s ease-in-out;
    background-color: transparent;

    &.disabled {
      pointer-events: none;
      opacity: 0.7;
      cursor: not-allowed;
    }
  }

  .fsEntitiesDropAreaShow {
    opacity: 1;
    transition: all 0.2s ease-in-out;
    background-color: var(--color-bg-control-primary-hover);
  }
</style>
