/*
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
*/

import { useRoute, useRouter } from 'vue-router';
import type { ListRoute, ContactRoute, NewContactRoute } from '../router';
import { NEW_EMPTY_CONTACT_ID } from '@main/common/constants';

export function useRouting() {
  const route = useRoute();
  const router = useRouter();

  async function goToList() {
    const r: ListRoute = {
      name: 'contacts',
    };
    return router.push(r);
  }

  async function goToContact(id: string, opts?: { edit?: boolean }) {
    const r: ContactRoute = {
      name: 'contact',
      params: { id },
      ...(opts?.edit && {
        query: { editMode: 'on' },
      }),
    };

    return router.push(r);
  }

  async function goToNew() {
    const r: NewContactRoute = {
      name: 'contact',
      params: { id: NEW_EMPTY_CONTACT_ID },
      query: { editMode: 'on' },
    };
    return router.push(r);
  }

  function getContactIdFromRoute(params?: ContactRoute['params']): string | undefined {
    const { id } = params ?? (route.params as ContactRoute['params']);
    return id;
  }

  function getEditStateFromRoute(query?: ContactRoute['query']): boolean {
    const { editMode } = query ?? (route.query as NonNullable<ContactRoute['query']>);
    return editMode === 'on';
  }

  function goBack() {
    router.back();
  }

  return {
    route,
    router,
    goToList,
    goToNew,
    goToContact,
    getContactIdFromRoute,
    getEditStateFromRoute,
    goBack,
  };
}
