import { createApp } from 'vue';
import { createPinia } from 'pinia';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  dialogs,
  notifications,
  storeDialogs,
  storeVueBus,
  storeNotifications,
  theme,
  vueBus,
} from '@v1nt1248/3nclient-lib/plugins';

import { piniaRouter } from '@/plugins/pinia-router';
import i18n from '@/data/i18';
import { router } from './router';

import App from '@/pages/app.vue';

import '@v1nt1248/3nclient-lib/variables.css';
import '@v1nt1248/3nclient-lib/style.css';
import '@/assets/styles/main.css';

import { initializationServices } from '@/services/services-provider';

initializationServices()
  .then(() => {
    const pinia = createPinia();
    pinia.use(piniaRouter);
    pinia.use(storeVueBus);
    pinia.use(storeDialogs);
    pinia.use(storeNotifications);

    const app = createApp(App);

    app.config.globalProperties.$router = router;
    // app.config.globalProperties.$store = store
    app.config.compilerOptions.isCustomElement = tag => {
      return tag.startsWith('ui3n-');
    };

    dayjs.extend(relativeTime);

    app
      .use(theme, { theme: 'dark' })
      .use(pinia)
      .use(i18n)
      .use(vueBus)
      .use(dialogs)
      .use(notifications)
      .use(router)
      .mount('#main');
  })
  .catch(err => {
    console.error('🔥 ERROR CREATE APP. ', err);
  });
