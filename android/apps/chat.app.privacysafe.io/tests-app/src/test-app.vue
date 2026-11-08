<!--
 Copyright (C) 2025 3NSoft Inc.

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
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import { onMounted, ref } from 'vue';
  import { setupBeforeAllTests, setupSecondaryUser } from './setups';
  import { addMsgToPage, ClosingParams, logErr } from './test-page-utils';
  import { Deferred } from './lib-common/processes/deferred.js';

  declare const w3n: web3n.testing.CommonW3N;

  const props = defineProps<Pick<Deferred<void>, 'resolve' | 'reject'>>();

  const setupProc = ref<'started' | 'done' | { err: any }>('started');

  onMounted(async () => {
    try {
      await setupBeforeAllTests();

      const { userId, userNum } = await w3n.testStand.staticTestInfo();
      if (userNum === 1) {
        setTimeout(() => w3n.testStand.focusThisWindow!(), 1000);
        (window as any).closeW3NAfterTests = {
          waitSecs: 15,
        } as ClosingParams;
        addMsgToPage(`1️⃣  Main test user '${userId}'`);
        document.getElementById('cancel-autoclose')!.hidden = false;
        await import('./tests/app-device-id.js');
        await import('./tests/backend-availability.js');
        await import('./tests/gui-log-relay.js');
        await import('./tests/app-view.js');
        await import('./tests/contacts-store.js');
        await import('./tests/chat-management.js');
        await import('./tests/chat-names.js');
        await import('./tests/messaging.js');
        await import('./tests/msg-modifications.js');
        await import('./tests/sync-conflicts.js');
        await import('./tests/backup-restore.js');
        await import('./tests/sync-activity.js');
        await import('./tests/group-members.js');
        await import('./tests/invitations.js');
        await import('./tests/video-chat.js');
        await import('./tests/call-state-recovery.js');
        await import('./tests/ice-config.js');
        await import('./tests/codec-preferences.js');
        await import('./tests/media-recording.js');
        // Only its `report-latency` case runs from here (five ~300B messages):
        // the burst cases are a deliberate storm against a real server and are
        // gated by RUN_HEAVY_BURSTS inside the file, off by default. The
        // measurement is worth having on every run — the heartbeat resend rests
        // on it, and one reading is not a distribution.
        await import('./tests/asmail-group-call-load.js');
      } else if (userNum === 2) {
        (window as any).skipW3NTests = true;
        addMsgToPage(`2️⃣  Second test user '${userId}'`);
        setupSecondaryUser(2);
      } else if (userNum === 3) {
        (window as any).skipW3NTests = true;
        addMsgToPage(`3️⃣  Third test user '${userId}'`);
        setupSecondaryUser(3);
      } else {
        // we expect only two test users
        addMsgToPage(`💥 we don't expect any other user. Correct either this code, or settings`);
      }

      props.resolve();
      setupProc.value = 'done';
    } catch (err) {
      setupProc.value = { err };
      console.error(`Setup before tests failed with error`, err);
      await logErr(`Setup before tests failed with error`, err);
      props.reject(err);
    }
  });
</script>

<template>
  <div v-if="setupProc === 'started'">
    🔄 setting up for tests.
  </div>
  <div v-else-if="setupProc === 'done'">
    ✅ setup is done.
  </div>
  <div v-else>
    💥 setup threw up. Check console for details.
  </div>
  <router-view v-slot="{ Component }">
    <transition>
      <component :is="Component" />
    </transition>
  </router-view>
</template>
