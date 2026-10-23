<script lang="ts" setup>
  import { computed, onBeforeMount } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useRouter, useRoute } from 'vue-router';
  import isEmpty from 'lodash/isEmpty';
  import { Ui3nMobileMenu, Ui3nMobileMenuItem } from '@v1nt1248/3nclient-lib';
  import { APP_USER_DEFAULT_MENU } from '@/common/constants';
  import { APP_MENU_DATA, type AppMenuItem } from './constants';
  import ContactIcon from '@/common/components/contact-icon.vue';
  import CustomScrollBar from '@/common/components/custom-scroll-bar.vue';

  const props = defineProps<{
    isMenuOpen: boolean;
    user: string;
    connectivityStatus: string;
    openUsers?: string[];
  }>();
  const emits = defineEmits<{
    (event: 'update:modelValue', value: boolean): void;
    (event: 'run-action', value: string): void;
  }>();

  const { t } = useI18n();
  const route = useRoute();
  const router = useRouter();

  const appMenu = computed(() =>
    APP_MENU_DATA.map(item => ({
      ...item,
      name: t(item.name),
    })),
  );

  const processedOpenUsers = computed(() =>
    (props.openUsers || []).map(u => ({
      id: u,
      name: u,
    })),
  );

  const appDefaultMenu = computed(() =>
    APP_USER_DEFAULT_MENU.map(i => ({
      id: i.key,
      name: t(i.label_key),
    })),
  );

  function isMenuItemSelected(item: AppMenuItem) {
    return route.name === item.routeName;
  }

  async function goToMenuItem(item: AppMenuItem) {
    await router.push({ name: item.routeName });
    emits('update:modelValue', false);
  }

  onBeforeMount(() => {});
</script>

<template>
  <ui3n-mobile-menu
    :model-value="isMenuOpen"
    width="260"
    with-blur
    @update:model-value="emits('update:modelValue', $event)"
  >
    <template #header>
      <div :class="$style.menuHeader">
        <contact-icon
          :size="36"
          :name="user"
          readonly
        />

        <div :class="$style.info">
          <div :class="$style.user">
            {{ user }}
          </div>

          <div :class="$style.status">
            <span>{{ t('app.status.label') }}</span>

            <b :class="connectivityStatus === 'online' && $style.ok" />
          </div>
        </div>
      </div>
    </template>

    <template #menuBody>
      <div :class="$style.body">
        <custom-scroll-bar>
          <ui3n-mobile-menu-item
            v-for="item in appMenu"
            :key="item.id"
            tabindex="1"
            :item="item"
            :is-active="isMenuItemSelected(item)"
            :class="$style.menuItem"
            @select-item="goToMenuItem"
          />
        </custom-scroll-bar>
      </div>
    </template>

    <template #footer>
      <div :class="$style.footer">
        <template v-if="!isEmpty(openUsers)">
          <ui3n-mobile-menu-item
            v-for="u in processedOpenUsers"
            :key="u.id"
            :item="u"
            :class="[$style.menuItem, u.id === user && $style.menuItemDisabled]"
            @select-item="ev => emits('run-action', ev.id)"
          />
        </template>

        <div :class="$style.separator" />

        <ui3n-mobile-menu-item
          v-for="item in appDefaultMenu"
          :key="item.id"
          :item="item"
          :class="$style.menuItem"
          @select-item="ev => emits('run-action', ev.id)"
        />
      </div>
    </template>
  </ui3n-mobile-menu>
</template>

<style lang="scss" module>
  @use '@/common/assets/styles/_mixins' as mixins;

  .menuHeader {
    display: flex;
    width: 100%;
    height: 64px;
    padding: 0 var(--spacing-s);
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    user-select: none;
  }

  .info {
    position: relative;
    width: calc(100% - 44px);
  }

  .user {
    font-size: var(--font-14);
    font-weight: 700;
    line-height: var(--font-18);
    @include mixins.text-overflow-ellipsis();
  }

  .status {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    font-size: var(--font-12);
    font-weight: 500;
    line-height: var(--font-16);

    b {
      position: relative;
      width: 12px;
      min-width: 12px;
      height: 12px;
      min-height: 12px;
      border-radius: 50%;
      background-color: var(--warning-content-default);
    }

    .ok {
      background-color: var(--success-content-default);
    }
  }

  .body {
    position: relative;
    height: 100%;
    padding: var(--spacing-s);
    user-select: none;
  }

  .menuItem {
    width: calc(100% - var(--spacing-s));
    margin-bottom: var(--spacing-xs);
    user-select: none;

    &.menuItemDisabled {
      pointer-events: none;
      opacity: 0.5;
    }
  }

  .footer {
    display: flex;
    width: 100%;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
    padding: var(--spacing-s);
    user-select: none;
  }

  .separator {
    position: relative;
    left: var(--spacing-s);
    width: calc(100% - var(--spacing-m));
    height: 1px;
    border-bottom: 1px solid var(--color-border-control-primary-default);
    margin: 2px 0;
  }
</style>
