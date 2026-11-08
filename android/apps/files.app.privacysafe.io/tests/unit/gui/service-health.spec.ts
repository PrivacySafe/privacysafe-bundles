import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServiceHealthCheck } from '../../../src/utils/service-health.ts';

// Regression for live testing item 10: when the Deno service lost its IPC connection,
// calls neither failed nor returned, and the GUI showed a spinner forever.
describe('createServiceHealthCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(ping: () => Promise<unknown>) {
    const onUnavailable = vi.fn();
    const check = createServiceHealthCheck({ ping, onUnavailable, interval: 1000, timeout: 500, maxFailures: 2 });
    return { check, onUnavailable };
  }

  it('stays silent while the service answers', async () => {
    const { check, onUnavailable } = setup(async () => ({}));
    check.start();

    await vi.advanceTimersByTimeAsync(10000);

    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it('reports once after the service stops answering', async () => {
    const { check, onUnavailable } = setup(() => new Promise(() => {}));
    check.start();

    await vi.advanceTimersByTimeAsync(1500); // first ping times out
    expect(onUnavailable).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500); // second one
    expect(onUnavailable).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10000);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it('reports failing pings', async () => {
    const { check, onUnavailable } = setup(async () => {
      throw { type: 'ipc', ipcNotConnected: true };
    });
    check.start();

    await vi.advanceTimersByTimeAsync(2000);

    expect(onUnavailable).toHaveBeenCalledWith({ type: 'ipc', ipcNotConnected: true });
  });

  it('does not count a failure followed by an answer', async () => {
    let fail = true;
    const { check, onUnavailable } = setup(async () => {
      const shouldFail = fail;
      fail = !fail;
      if (shouldFail) {
        throw new Error('busy');
      }
    });
    check.start();

    await vi.advanceTimersByTimeAsync(10000);

    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it('reports a failure of the event subscription at once', () => {
    const { check, onUnavailable } = setup(async () => ({}));
    check.start();

    check.reportFailure({ type: 'rpc', connectionClosed: true });

    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it('reports nothing after stop, when the app is closing', async () => {
    const { check, onUnavailable } = setup(() => new Promise(() => {}));
    check.start();
    check.stop();

    check.reportFailure({ type: 'rpc', connectionClosed: true });
    await vi.advanceTimersByTimeAsync(10000);

    expect(onUnavailable).not.toHaveBeenCalled();
  });
});
