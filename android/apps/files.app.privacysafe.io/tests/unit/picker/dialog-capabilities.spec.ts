import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDialogRequestState,
  failDialog,
  registerDialogCapabilities,
  settleDialog,
} from '../../../src-file-picker/common/dialog-capabilities.ts';

type Handler = (...args: unknown[]) => Promise<unknown>;

const w3nStub = w3n as unknown as Record<string, unknown>;
let handlers: Record<string, Handler>;
let closeSelf: ReturnType<typeof vi.fn>;

function setup() {
  const dialogRequest = createDialogRequestState();
  registerDialogCapabilities(dialogRequest);
  return dialogRequest;
}

beforeEach(() => {
  vi.useFakeTimers();
  handlers = {};
  closeSelf = vi.fn();
  w3nStub.rpc = {
    provideCAPtoSystem: (name: string, handler: Handler) => {
      handlers[name] = handler;
    },
  };
  w3nStub.closeSelf = closeSelf;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  delete w3nStub.rpc;
  delete w3nStub.closeSelf;
});

describe('file dialog requests', () => {
  it('answers the caller once and then closes the window', async () => {
    const dialogRequest = setup();
    const answer = handlers['w3n.shell.fileDialogs.openFileDialog']('Title', 'Open', false);

    settleDialog(dialogRequest, []);
    settleDialog(dialogRequest, undefined);

    await expect(answer).resolves.toEqual([]);
    await vi.runAllTimersAsync();
    expect(closeSelf).toHaveBeenCalled();
  });

  it('normalizes the parameters of another app', () => {
    const dialogRequest = setup();

    void handlers['w3n.shell.fileDialogs.saveFileDialog'](42, null, 'docs/a.txt', {
      filters: [{ name: 'broken' }, { name: 'txt', extensions: ['txt', 1] }],
    });

    expect(dialogRequest).toMatchObject({
      mode: 'saveFile',
      title: '',
      btnLabel: '',
      defaultPath: 'docs/a.txt',
      filters: [{ name: 'txt', extensions: ['txt'] }],
    });
  });

  // Regression for the picker plan, item 6: a failed start answered undefined,
  // which the caller cannot tell from a cancellation.
  it('rejects a pending request when the picker fails to start', async () => {
    const dialogRequest = setup();
    const answer = handlers['w3n.shell.fileDialogs.openFolderDialog']('t', 'ok', false);

    failDialog(dialogRequest, new Error('service is down'));

    await expect(answer).rejects.toThrow('service is down');
  });

  it('rejects a request that arrives after a failed start', async () => {
    const dialogRequest = setup();

    failDialog(dialogRequest, new Error('service is down'));
    const answer = handlers['w3n.shell.fileDialogs.saveFolderDialog']('t', 'ok', '');

    await expect(answer).rejects.toThrow('service is down');
    expect(dialogRequest.mode).toBeNull();
  });

  it('closes the window when no request comes after a failed start', async () => {
    const dialogRequest = setup();

    failDialog(dialogRequest, new Error('service is down'));
    await vi.advanceTimersByTimeAsync(5000);

    expect(closeSelf).toHaveBeenCalled();
  });

  it('answers a cancellation without closing the window when asked so', async () => {
    const dialogRequest = setup();
    const answer = handlers['w3n.shell.fileDialogs.openFileDialog']('t', 'ok', true);

    settleDialog(dialogRequest, undefined, { closeWindow: false });

    await expect(answer).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    expect(closeSelf).not.toHaveBeenCalled();
  });
});
