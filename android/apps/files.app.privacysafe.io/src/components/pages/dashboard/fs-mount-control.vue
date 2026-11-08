<script lang="ts" setup>
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import { Ui3nButton } from '@v1nt1248/3nclient-lib';
  import { useFsStore } from '@/store';

  const props = defineProps<{ fsId: string }>();
  const { t } = useI18n();
  const fsStore = useFsStore();
  const { fsMountStatus, fsMountBusy } = storeToRefs(fsStore);
  const status = computed(() => fsMountStatus.value[props.fsId] || 'unmounted');
  const busy = computed(() => !!fsMountBusy.value[props.fsId]);
</script>

<template>
  <div
    v-if="fsStore.canMountFs(fsId)"
    :class="$style.mountControl"
  >
    <ui3n-button
      type="custom"
      color="transparent"
      text-color="var(--color-text-control-primary-default)"
      :icon="status === 'mounted' ? 'cancel-outline-rounded' : 'round-add-circle-outline'"
      icon-size="16"
      icon-position="left"
      :disabled="busy"
      @click="fsStore.setFsMounted(fsId, status !== 'mounted')"
    >
      {{
        t(
          busy
            ? 'fs.mount.button.busy'
            : status === 'mounted'
              ? 'fs.mount.button.unmount'
              : 'fs.mount.button.mount',
        )
      }}
    </ui3n-button>
  </div>
</template>

<style lang="scss" module>
  .mountControl {
    padding: 0 var(--spacing-s) var(--spacing-s);
  }
</style>
