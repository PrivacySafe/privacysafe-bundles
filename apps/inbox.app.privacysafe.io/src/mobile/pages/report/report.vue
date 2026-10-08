<!--
 Copyright (C) 2026 3NSoft Inc.

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
  import { computed, onBeforeMount } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import type { Nullable } from '@v1nt1248/3nclient-lib';
  import { useAppStore, useMessagesStore } from '@common/store';
  import { SYSTEM_FOLDERS } from '@common/constants';
  import type { IncomingMessageView } from '@common/types';
  import { sameAddress } from '@shared/utils/address-utils';
  import ReportForm from '@mobile/pages/report/report-form.vue';

  const route = useRoute();
  const router = useRouter();

  const { getMessage } = useMessagesStore();
  const appStore = useAppStore();

  const sourceFolder = computed(() => route.query.sourceFolder as string | undefined);

  const message = computed<Nullable<IncomingMessageView>>(() => {
    const msg = getMessage(route.params.msgId as string) as Nullable<IncomingMessageView>;
    if (!msg || !msg.sender || sameAddress(msg.sender, appStore.user)) {
      return null;
    }

    return msg;
  });

  function leave() {
    router.replace({
      name: 'folder',
      params: {
        folderId: sourceFolder.value || message.value?.mailFolder || SYSTEM_FOLDERS.inbox,
      },
    });
  }

  onBeforeMount(() => {
    if (!message.value) {
      leave();
    }
  });
</script>

<template>
  <div :class="$style.report">
    <report-form
      v-if="message"
      :message="message"
      @close="leave()"
    />
  </div>
</template>

<style lang="scss" module>
  .report {
    position: fixed;
    inset: 0;
    background-color: var(--color-bg-block-primary-default);
  }
</style>
