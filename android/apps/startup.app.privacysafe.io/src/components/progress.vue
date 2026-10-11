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
<script setup lang="ts">
  import { inject, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useRouter } from 'vue-router';
  import { storeToRefs } from 'pinia';
  import { NOTIFICATIONS_KEY } from '@v1nt1248/3nclient-lib/plugins';
  import { useSignupStore } from '@/stores/signup.store';
  import { useLoggedInUserStore } from '@/stores/logged-in-user.store';
  import { APP_ROUTES } from '@/constants';
  import StartupFooter from '@/components/startup-footer.vue';

  const { t } = useI18n();
  const router = useRouter();
  const { $createNotice } = inject(NOTIFICATIONS_KEY)!;

  const signupStore = useSignupStore();
  const { keyGenerationProc, address, srvToken, password } = storeToRefs(signupStore);
  const { setStoreFieldValue } = signupStore;

  const { setUserId } = useLoggedInUserStore();

  const isProcessing = ref(false);

  async function createAccountOnServer() {
    try {
      const token = srvToken.value || undefined;

      console.warn(`skipping creation of account in debug process`);
      const added = await w3n.signUp.addUser(address.value, token);
      if (added) {
        setUserId(address.value);
        return router.push({ name: APP_ROUTES.POSTLOGIN });
      }

      $createNotice({
        type: 'warning',
        content: t('err.singup_available_err', { address: address.value }),
        duration: 4000,
      });

      setTimeout(() => {
        return router.push({ name: APP_ROUTES.SIGNUP, query: { step: 2 } });
      }, 4000);
    } catch (err) {
      $createNotice({
        type: 'error',
        content: t('err.singup_general_err'),
        duration: 0,
      });
      console.error(err);
    }
  }

  onMounted(async () => {
    isProcessing.value = true;
    setStoreFieldValue('keyGenerationProc', 0);

    w3n.signUp
    .createUserParams(password.value, p => {
      setStoreFieldValue('keyGenerationProc', p);
    })
    .then(async () => {
      setStoreFieldValue('keyGenerationProc', undefined);
      await createAccountOnServer();
    })
    .catch(err => {
      console.error(err);
      setStoreFieldValue('keyGenerationProc', undefined);
      isProcessing.value = false;
      $createNotice({
        type: 'error',
        content: t('err.singup_general_err'),
        duration: 0,
      });
    });
  });
</script>

<template>
  <section>
    <div :class="$style.progressPage">

      <!-- SVG animated thing.
           Note that v-class doesn't work nicely inside svg tag, hence, classes for it ain't scoped.
      -->
      <div class="anim-svg-scene">
        <div class="anim-svg-stage">
          <svg class="anim-rings-svg" viewBox="0 0 360 360" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <filter id="go" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <filter id="gb" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <filter id="gg" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>

            <g class="anim-rings-group-1">
              <circle class="anim-ring anim-ring-1" cx="180" cy="180" r="140" stroke-dasharray="660 200" filter="url(#go)"/>
              <circle class="anim-ring anim-ring-2" cx="180" cy="180" r="148" stroke-dasharray="400 530"/>
            </g>
            <g class="anim-rings-group-2">
              <circle class="anim-ring anim-ring-4" cx="180" cy="180" r="133" stroke-dasharray="550 280" filter="url(#go)"/>
              <circle class="anim-ring anim-ring-3" cx="180" cy="180" r="155" stroke-dasharray="300 680"/>
            </g>
            <g class="anim-rings-group-3">
              <circle class="anim-ring" cx="180" cy="180" r="126" stroke="#ff4820" stroke-width="1.5" fill="none" stroke-dasharray="200 694" opacity="0.4"/>
            </g>

            <g>
              <animateTransform attributeName="transform" type="rotate" from="0 180 180" to="360 180 180" dur="9s" repeatCount="indefinite"/>
              <circle cx="180" cy="40" r="5" fill="#4ab8f5" filter="url(#gb)" opacity="0.9">
                <animate attributeName="r" values="4;6;4" dur="3s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="0.7;1;0.7" dur="3s" repeatCount="indefinite"/>
              </circle>
              <circle cx="180" cy="40" r="2" fill="#fff" opacity="0.8"/>
              <circle cx="290" cy="240" r="4" fill="#5abfee" filter="url(#gb)" opacity="0.8">
                <animate attributeName="r" values="3;5;3" dur="4s" repeatCount="indefinite"/>
              </circle>
              <circle cx="290" cy="240" r="1.5" fill="#fff" opacity="0.7"/>
              <circle cx="70" cy="260" r="3.5" fill="#60c8f5" filter="url(#gb)" opacity="0.75">
                <animate attributeName="r" values="2.5;4.5;2.5" dur="5s" repeatCount="indefinite"/>
              </circle>
            </g>

            <g>
              <animateTransform attributeName="transform" type="rotate" from="180 180 180" to="-180 180 180" dur="13s" repeatCount="indefinite"/>
              <circle cx="180" cy="47" r="5.5" fill="#2ecc78" filter="url(#gg)" opacity="0.9">
                <animate attributeName="r" values="4;7;4" dur="4s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="0.7;1;0.7" dur="4s" repeatCount="indefinite"/>
              </circle>
              <circle cx="180" cy="47" r="2" fill="#fff" opacity="0.85"/>
              <circle cx="75" cy="120" r="4" fill="#26d070" filter="url(#gg)" opacity="0.8">
                <animate attributeName="r" values="3;5;3" dur="6s" repeatCount="indefinite"/>
              </circle>
              <circle cx="300" cy="150" r="3" fill="#3acc6a" filter="url(#gg)" opacity="0.7">
                <animate attributeName="r" values="2;4;2" dur="5s" repeatCount="indefinite"/>
              </circle>
            </g>

            <g>
              <animateTransform attributeName="transform" type="rotate" from="90 180 180" to="450 180 180" dur="20s" repeatCount="indefinite"/>
              <circle cx="180" cy="50" r="2" fill="#80d0f0" opacity="0.5"><animate attributeName="opacity" values="0.3;0.7;0.3" dur="3s" repeatCount="indefinite"/></circle>
              <circle cx="320" cy="200" r="1.5" fill="#4ab88a" opacity="0.5"><animate attributeName="opacity" values="0.2;0.6;0.2" dur="4s" repeatCount="indefinite"/></circle>
              <circle cx="100" cy="310" r="1.5" fill="#80d0f0" opacity="0.4"><animate attributeName="opacity" values="0.2;0.5;0.2" dur="5s" repeatCount="indefinite"/></circle>
              <circle cx="250" cy="320" r="2" fill="#4ab88a" opacity="0.45"><animate attributeName="opacity" values="0.25;0.6;0.25" dur="3.5s" repeatCount="indefinite"/></circle>
            </g>
          </svg>

          <svg class="anim-logo-center" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
            <defs>
              <linearGradient id="ll1"><stop stop-color="#157ee9" offset="0"/><stop stop-color="#3ecc78" offset="1"/></linearGradient>
              <linearGradient id="ll2" x1="115.86" x2="301.39" y1="186" y2="186" gradientTransform="matrix(1.0349 0 0 1.0362 -119.91 -41.101)" gradientUnits="userSpaceOnUse" xlink:href="#ll1"/>
              <linearGradient id="ll3" x1="115.86" x2="301.39" y1="186" y2="186" gradientTransform="matrix(1.0834 0 0 1.1328 -131.27 -85.479)" gradientUnits="userSpaceOnUse" xlink:href="#ll1"/>
              <linearGradient id="ll4" x1="51.714" x2="210.4" y1="99.77" y2="99.77" gradientTransform="matrix(.70336 0 0 .74173 1325.6 185.44)" gradientUnits="userSpaceOnUse">
                <stop stop-color="#ef2008" offset="0"/><stop stop-color="#ff6428" offset="1"/>
              </linearGradient>
            </defs>
            <g transform="matrix(1.3593 0 0 1.3634 -1831.3 -263.48)" stroke-width=".73458">
              <path d="m1417.8 200.59c-29.973 0.0625-54.547 25.082-55.659 56.668h25.262c1.2426-18.172 14.573-32.213 30.629-32.259 16.056 0.0459 29.388 14.086 30.63 32.259h24.895c-1.1135-31.627-25.746-56.662-55.758-56.668z" fill="url(#ll4)"/>
            </g>
            <path d="m0 99.694v22.241l192 1e-5v-22.241z" fill="url(#ll2)"/>
            <path d="m20.275 134.37c14.467 28.336 42.944 47.563 75.647 47.631 32.762-7e-3 61.31-19.248 75.802-47.631z" fill="url(#ll3)"/>
          </svg>
        </div>
      </div>

      <div :class="$style.text">
        {{ (keyGenerationProc !== undefined) ?
          `${t('signup.step.progress.key_generation_txt')} ${keyGenerationProc} %` :
          t('signup.step.progress.txt')
        }}
        <br>
        {{ address }}
      </div>

    </div>

    <startup-footer>
      <div :class="$style.footer">
        <span> </span>
      </div>
    </startup-footer>
  </section>
</template>

<style lang="scss" module>
  .progressPage {
    position: relative;
    width: 100%;
    min-height: calc(var(--spacing-xxl)*10);
    padding-left: var(--spacing-s);
    padding-right: var(--spacing-s);

    .logoBlock {
      width: 100%;
      img {
        width: calc(100% - var(--spacing-s));
      }
      margin-top: calc(var(--spacing-xl) * 2 - var(--spacing-m));
    }

    font-size: var(--font-16);
    font-weight: 600;
    line-height: var(--font-32);

    .text {
      width: 100%;
      margin-top: var(--spacing-ml);
      text-align: center;
    }

    .progress {
      width: 100%;
      margin-top: var(--spacing-m);
      text-align: center;
      color: var(--signin-green);
    }

  }

  .footer {
    display: flex;
    align-items: center;
    justify-content: center;
    span {
      padding-right: var(--spacing-xs);
    }
  }
</style>

<style>

  .anim-svg-scene {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
  }

  .anim-svg-stage {
    position: relative;
    width: 360px;
    height: 360px;
  }
  .anim-logo-center {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 80px;
    height: 80px;
    z-index: 10;
  }
  .anim-rings-svg {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
  }
  .anim-ring { fill: none; stroke-linecap: round; }
  .anim-ring-1 { stroke: #ff4010; stroke-width: 3; opacity: 0.95; }
  .anim-ring-2 { stroke: #ff5520; stroke-width: 1.5; opacity: 0.55; }
  .anim-ring-3 { stroke: #ff6830; stroke-width: 1; opacity: 0.3; }
  .anim-ring-4 { stroke: #ff3000; stroke-width: 2; opacity: 0.7; }
  .anim-rings-group-1 { transform-origin: 180px 180px; animation: rotateCW 12s linear infinite; }
  .anim-rings-group-2 { transform-origin: 180px 180px; animation: rotateCCW 18s linear infinite; }
  .anim-rings-group-3 { transform-origin: 180px 180px; animation: rotateCW 24s linear infinite; }
  @keyframes rotateCW  { from{transform:rotate(0deg)}   to{transform:rotate(360deg)} }
  @keyframes rotateCCW { from{transform:rotate(0deg)}   to{transform:rotate(-360deg)} }

</style>
