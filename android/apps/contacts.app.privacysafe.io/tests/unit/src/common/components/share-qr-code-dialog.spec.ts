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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { render, cleanup, fireEvent } from '@testing-library/vue';
import { NOTIFICATIONS_KEY } from '@v1nt1248/3nclient-lib/plugins';
import { useAppStore } from '@main/common/store/app.store';
import ShareQrDialog from '@main/common/components/dialogs/share-qr-code-dialog.vue';
import i18n from '@main/common/data/i18';
import type { Person } from '@main/types';
import { stubResizeObserver } from '../../../helpers/app-context.ts';

function stubCanvas() {
  if (!('Path2D' in globalThis)) {
    (globalThis as unknown as Record<string, unknown>).Path2D = class {
      addPath() {
        /* no-op */
      }
    };
  }

  Object.defineProperty(globalThis.Image.prototype, 'src', {
    set(this: HTMLImageElement) {
      setTimeout(() => {
        this.onload?.(new Event('load'));
      }, 0);
    },
    configurable: true,
  });

  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    putImageData: vi.fn(),
    createImageData: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    fillText: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    transform: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    roundRect: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.toBlob = vi.fn((callback: (blob: Blob | null) => void) => {
    callback(new Blob(['fake-png-bytes'], { type: 'image/png' }));
  }) as unknown as typeof HTMLCanvasElement.prototype.toBlob;
}

describe('share-qr-code-dialog', () => {
  const createNoticeMock = vi.fn();

  function renderDialog(contactData: Person | null | undefined = null) {
    stubResizeObserver();
    stubCanvas();
    const pinia = createPinia();
    setActivePinia(pinia);
    const appStore = useAppStore();
    appStore.user = 'owner@3nweb.com';

    return render(ShareQrDialog, {
      props: {
        contactData,
      },
      global: {
        plugins: [pinia, i18n],
        provide: {
          [NOTIFICATIONS_KEY as unknown as string]: {
            $createNotice: createNoticeMock,
          },
        },
        config: {
          compilerOptions: { isCustomElement: (tag: string) => tag.startsWith('ui3n-') },
        },
      },
    });
  }

  beforeEach(() => {
    stubResizeObserver();
    stubCanvas();
    createNoticeMock.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders gracefully when contactData is null or undefined', async () => {
    const { container } = renderDialog(null);
    await nextTick();
    expect(container).toBeDefined();
  });

  it('renders contact email and URL when contactData is provided', async () => {
    const contact: Person = {
      id: 'c1',
      name: 'Alice Smith',
      mail: 'alice@3nweb.com',
      timestamp: 1,
    };
    const { getByText } = renderDialog(contact);
    await nextTick();
    expect(getByText('alice@3nweb.com')).toBeDefined();
    expect(getByText('w3n://add-contact/?a=alice%403nweb.com&n=Alice%20Smith')).toBeDefined();
  });

  it('omits name in URL when contact is own address', async () => {
    const contact: Person = {
      id: 'c-own',
      name: 'Owner',
      mail: 'owner@3nweb.com',
      timestamp: 1,
    };
    const { getByText } = renderDialog(contact);
    await nextTick();
    expect(getByText('w3n://add-contact/?a=owner%403nweb.com')).toBeDefined();
  });

  it('updates QR code when contactData changes', async () => {
    const contact: Person = {
      id: 'c1',
      name: 'Alice',
      mail: 'alice@3nweb.com',
      timestamp: 1,
    };
    const { getByText, rerender } = renderDialog(contact);
    await nextTick();
    expect(getByText('alice@3nweb.com')).toBeDefined();

    await rerender({
      contactData: {
        id: 'c2',
        name: 'Bob',
        mail: 'bob@3nweb.com',
        timestamp: 2,
      },
    });
    await nextTick();

    expect(getByText('bob@3nweb.com')).toBeDefined();
    expect(getByText('w3n://add-contact/?a=bob%403nweb.com&n=Bob')).toBeDefined();
  });

  it('copies contact URL to clipboard and shows success notice', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const contact: Person = {
      id: 'c1',
      name: 'Alice',
      mail: 'alice@3nweb.com',
      timestamp: 1,
    };
    const { container } = renderDialog(contact);
    await nextTick();

    const copyButton = container.querySelector('[data-icon="round-content-copy"]')?.closest('button');
    expect(copyButton).toBeDefined();

    await fireEvent.click(copyButton!);

    expect(writeTextMock).toHaveBeenCalledWith('w3n://add-contact/?a=alice%403nweb.com&n=Alice');
    expect(createNoticeMock).toHaveBeenCalledWith({
      type: 'success',
      content: 'Link Copied',
    });
  });

  it('downloads QR code using saveFileDialog with png filter', async () => {
    const writeBytesMock = vi.fn().mockResolvedValue(undefined);
    const saveFileDialogMock = vi.fn().mockResolvedValue({
      name: 'QR-Code-alice@3nweb.com.png',
      writeBytes: writeBytesMock,
    });

    (globalThis as unknown as Record<string, unknown>).w3n = {
      shell: {
        fileDialogs: {
          saveFileDialog: saveFileDialogMock,
        },
      },
    };

    const contact: Person = {
      id: 'c1',
      name: 'Alice',
      mail: 'alice@3nweb.com',
      timestamp: 1,
    };
    const { container } = renderDialog(contact);
    await nextTick();

    const downloadButton = container.querySelector('[data-icon="outline-download-for-offline"]')?.closest('button');
    expect(downloadButton).toBeDefined();

    await fireEvent.click(downloadButton!);

    // wait for async downloadQRcode execution
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(saveFileDialogMock).toHaveBeenCalledWith(
      'Save QR Code',
      'Save ME',
      'QR-Code-alice@3nweb.com.png',
      { filters: [{ name: 'PNG Image', extensions: ['png'] }] },
    );
    expect(writeBytesMock).toHaveBeenCalled();
    expect(createNoticeMock).toHaveBeenCalledWith({
      type: 'success',
      content: 'QR Code save successfully',
    });
  });

  it('switches colors and closes color picker', async () => {
    const contact: Person = {
      id: 'c1',
      name: 'Alice',
      mail: 'alice@3nweb.com',
      timestamp: 1,
    };
    const { container, getByText } = renderDialog(contact);
    await nextTick();

    // Open color picker
    const colorButton = container.querySelector('[data-icon="outline-color-lens"]')?.closest('button');
    expect(colorButton).toBeDefined();
    await fireEvent.click(colorButton!);
    await nextTick();

    // Color picker panel is visible with close button
    const closeButton = getByText('Close').closest('button');
    expect(closeButton).toBeDefined();

    // Select another color swatch
    const swatches = container.querySelectorAll('[style*="background-color"]');
    expect(swatches.length).toBeGreaterThan(1);
    await fireEvent.click(swatches[1]);
    await nextTick();

    // Close color picker panel
    await fireEvent.click(closeButton!);
    await nextTick();

    expect(container.querySelector('[data-icon="outline-color-lens"]')).toBeDefined();
  });
});
