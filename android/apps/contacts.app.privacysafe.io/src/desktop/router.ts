import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router';
import Contacts from '@main/desktop/pages/contacts/contacts.vue';
import Contact from '@main/desktop/pages/contact/contact.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/contacts' },
  { path: '/index.html', redirect: '/contacts' },
  {
    path: '/contacts',
    name: 'contacts',
    component: Contacts,
    children: [
      {
        name: 'contact',
        path: ':id',
        component: Contact,
        props: true,
      },
    ],
  },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
