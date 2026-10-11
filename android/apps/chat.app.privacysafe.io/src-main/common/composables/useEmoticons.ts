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
import get from 'lodash/get';
import { emoticons } from '@v1nt1248/3nclient-lib/utils';
import type { Nullable } from '@v1nt1248/3nclient-lib';

export function useEmoticons() {
  const emoticonsByGroups = Object.keys(emoticons).reduce(
    (res, id) => {
      const { group, value } = emoticons[id];
      if (!res[group]) {
        res[group] = [];
      }
      res[group].push({ id, value });

      return res;
    },
    {} as Record<string, { id: string, value: string }[]>,
  );

  const groups = Object.keys(emoticonsByGroups);

  const peopleGrInd = groups.findIndex(g => (g.toLowerCase() == 'people'));
  if (peopleGrInd > 0) {
    const peopleGr = groups.splice(peopleGrInd, 1)[0];
    groups.unshift(peopleGr);
  }

  function getEmojiById(emojiId: string): Nullable<{ value: string; group: string }> {
    return get(emoticons, emojiId, null);
  }

  return {
    emoticonsByGroups,
    groups,
    getEmojiById,
  };
}
