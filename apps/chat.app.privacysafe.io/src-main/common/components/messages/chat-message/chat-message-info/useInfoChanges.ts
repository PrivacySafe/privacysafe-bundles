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
import type { ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import isEmpty from 'lodash/isEmpty';
import dayjs from 'dayjs';
import type { ChatMessageHistoryChange } from '~/index';

const dateTimeFormat = 'YYYY-MM-DD HH:mm:ss';

export function useInfoChanges(changes: ComputedRef<ChatMessageHistoryChange[]>, ts: number) {
  const { t } = useI18n();

  function getTimeForBlockNow() {
    return isEmpty(changes.value) ? ts : changes.value[0].timestamp;
  }

  function prepareTimeForBlockNow() {
    const currentTS = getTimeForBlockNow();
    return `${t('chat.message.info.since')} ${dayjs(currentTS).format(dateTimeFormat)}`;
  }

  function prepareTimeForBlockHistory(ind: number) {
    const fromTs = ind === changes.value.length - 1 ? ts : changes.value[ind + 1].timestamp;
    const toTs = ind === 0 ? getTimeForBlockNow() : changes.value[ind].timestamp;

    return t('chat.message.info.between', {
      from: dayjs(fromTs).format(dateTimeFormat),
      to: dayjs(toTs).format(dateTimeFormat),
    });
  }

  return {
    t,
    prepareTimeForBlockNow,
    prepareTimeForBlockHistory,
  };
}
