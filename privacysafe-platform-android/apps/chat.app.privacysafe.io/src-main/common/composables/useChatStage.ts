/*
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
*/
import { onBeforeUnmount, ref, shallowRef, type Ref, type ShallowRef } from 'vue';

export interface ChatStage {
  /** The host element media is shown over. Null until the view mounts it. */
  el: ShallowRef<HTMLElement | null>;
  width: Ref<number>;
  height: Ref<number>;
  /** Template ref callback for the host: `:ref="setEl"`. */
  setEl(el: Element | ComponentPublicInstanceLike | null): void;
  /** Reads the box now, for a click that arrives before the observer fired. */
  measureNow(): void;
}

/** What Vue hands a ref callback when it is put on a component. */
type ComponentPublicInstanceLike = { $el?: unknown };

export const CHAT_STAGE_KEY = 'chat-stage';

/**
 * The area a video message is played over, and its measured size.
 *
 * Measured rather than taken from the app store: `appWindowSize` is fed by the
 * ui3n-resize directive on the desktop root only, so on mobile it stays at
 * zero. The directive itself cannot be used for a second element either - it
 * keeps its ResizeObserver in a variable of its own module, so a second use
 * takes the first one's place - hence a plain observer here.
 */
export function useChatStage(): ChatStage {
  const el = shallowRef<HTMLElement | null>(null);
  const width = ref(0);
  const height = ref(0);

  let observer: ResizeObserver | undefined = undefined;

  function stopObserving(): void {
    observer?.disconnect();
    observer = undefined;
  }

  function measureNow(): void {
    const host = el.value;
    if (!host) {
      width.value = 0;
      height.value = 0;
      return;
    }
    const box = host.getBoundingClientRect();
    width.value = Math.round(box.width);
    height.value = Math.round(box.height);
  }

  function setEl(value: Element | ComponentPublicInstanceLike | null): void {
    stopObserving();

    const host = (value && ('$el' in value)) ? (value.$el as HTMLElement | null) : (value as HTMLElement | null);
    el.value = host ?? null;
    if (!host) {
      width.value = 0;
      height.value = 0;
      return;
    }

    observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.target !== host) {
          continue;
        }
        const { width: w, height: h } = entry.contentRect;
        width.value = Math.round(w);
        height.value = Math.round(h);
      }
    });
    // observe() reports the current box straight away, so the initial size
    // needs no separate measurement.
    observer.observe(host);
  }

  onBeforeUnmount(stopObserving);

  return { el, width, height, setEl, measureNow };
}
