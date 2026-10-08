/*
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
*/
import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router';
import { APP_ROUTES } from '@/constants';
import Signin from '@/pages/signin.vue';
import Signup from '@/pages/signup.vue';
import PostLoginSplashscreen from '@/pages/post-login-splashscreen.vue';
import type { SignupParamsViaURL } from './utils/signup-links';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/signin' },
  { path: '/signin', name: APP_ROUTES.SIGNIN, component: Signin },
  { path: '/signup', name: APP_ROUTES.SIGNUP, component: Signup },
  { path: '/post-login', name: APP_ROUTES.POSTLOGIN, component: PostLoginSplashscreen },
  { path: '/:catchAll(.*)', redirect: '/signin' },
];

// this is captured before router is created, and necessarily before it messes up location.hash
export const signupParamsFromURL = (function() {
  if (location.hash) {
    try {
      return JSON.parse(atob(location.hash.substring(1))) as SignupParamsViaURL;
    } catch (err) {
      console.error(`Attempt to parse signup params from initial load hash erred:`, err);
    }
  }
  return undefined;
})();

export const router = createRouter({
  history: createWebHashHistory(),
  routes
});
