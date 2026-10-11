/*
Copyright (C) 2024 - 2025 3NSoft Inc.

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

import { ref, shallowRef, watch } from "vue";

export interface AppWindowSize {
  width: number;
  height: number;
}

export function makeAppSize() {

  const appElement = shallowRef<HTMLElement>();

  const appWindowSize = ref<AppWindowSize>({
    width: 0,
    height: 0,
  });

  function setAppWindowSize({ width, height }: AppWindowSize) {
    appWindowSize.value = {
      ...appWindowSize.value,
      ...(width && { width }),
      ...(height && { height }),
    };
  }

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { contentRect, target } = entry;
      const { className } = target;
      const { width, height } = contentRect;
      if (className === appElement.value!.className) {
        setAppWindowSize({ width, height });
        break;
      }
    }
  });

  const appElemWatching = watch(appElement, (elem) => {
    if (elem) {
      const { width, height } = elem.getBoundingClientRect();
      setAppWindowSize({ width, height });
      resizeObserver.observe(elem);
    }
  });

  function stopWatching() {
    appElemWatching.stop();
  }

  return {
    appElement,

    stopWatching
  };
}
