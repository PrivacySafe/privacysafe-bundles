<!--
 Copyright (C) 2024 - 2026 3NSoft Inc.

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
<script lang="ts" setup>
import { onBeforeMount } from 'vue';
import { useLoggedInUserStore } from '@/stores/logged-in-user.store';
import { useSignupStore } from '@/stores/signup.store';
import { useBootEventsStore } from '@/stores/boot-events.store';
import { signupParamsFromURL } from '@/routes';
import { sleep } from '@v1nt1248/3nclient-lib/utils';
import { useRouter } from 'vue-router';
import { APP_ROUTES } from '@/constants';
import { storeToRefs } from 'pinia';

const router = useRouter();

const bootEventsStore = useBootEventsStore();
bootEventsStore.startWatchBoot();

const loggedInUserStore = useLoggedInUserStore();

const signupStore = useSignupStore();
const { initStandard, checkSignupParamsAndSetDomains } = signupStore;
const { availableDomains } = storeToRefs(signupStore);

onBeforeMount(async () => {
  await loggedInUserStore.loadUsersFromDisk();
  await initStandard();

  // push route and values with signup params from url, but only once, hence, calling here
  if (signupParamsFromURL) {
    sleep(10).then(async () => {
      const haveSignupDomains = await checkSignupParamsAndSetDomains(signupParamsFromURL!);
      if (haveSignupDomains) {
        router.push({
          name: APP_ROUTES.SIGNUP,
          query: {
            step: 2,
            domain: availableDomains.value[0]
          },
        });
      }
    });
  }
});
</script>

<template>
  <section :class="$style.app">
    <div :class="$style.body">
      <router-view v-slot="{ Component }">
        <transition>
          <component :is="Component" />
        </transition>
      </router-view>
    </div>
  </section>
</template>

<style lang="scss" module>
  .app {
    position: fixed;
    inset: 0;

    // pitch black background to match animation. Should it be for all, or only those steps?
    background: #000;
    // background-color: var(--color-bg-block-primary-default);

    color: var(--color-text-block-primary-default);
  }

  .body {
    position: fixed;
    width: 100%;
    height: 100%;
    overflow: hidden auto;
  }
</style>
