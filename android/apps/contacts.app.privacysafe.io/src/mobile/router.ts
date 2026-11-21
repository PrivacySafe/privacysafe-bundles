import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router';
import List from '@main/mobile/pages/list.vue';
import Contact from '@main/mobile/pages/contact.vue';
import { NEW_EMPTY_CONTACT_ID, NEW_POPULATED_CONTACT_ID } from '@main/common/constants';

export interface ListRoute {
  name: 'contacts';
}

export interface ContactRoute {
  name: 'contact';
  params: {
    id: string;
  };
  query?: {
    editMode?: 'on';
  };
}

export interface NewContactRoute extends ContactRoute {
  params: {
    id: typeof NEW_EMPTY_CONTACT_ID | typeof NEW_POPULATED_CONTACT_ID;
  };
  query: {
    editMode: 'on';
  };
}


const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/list' },
  { path: '/index-mobile.html', redirect: '/list' },
  {
    path: '/list',
    name: 'contacts',
    component: List,
  },
  {
    path: '/contact/:id',
    name: 'contact',
    component: Contact,
  },
];



export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
