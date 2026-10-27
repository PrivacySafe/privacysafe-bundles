import { describe, expect, it } from 'vitest';
import { isIpcConnectionLost } from '../../../shared/utils/ipc/ipc-connection-lost.ts';

describe('isIpcConnectionLost', () => {
  it('recognizes a stopped connector and a lost connection', () => {
    expect(isIpcConnectionLost({ runtimeException: true, type: 'ipc', connectorStop: true })).toBe(true);
    expect(isIpcConnectionLost({ runtimeException: true, type: 'ipc', ipcNotConnected: true })).toBe(true);
  });

  it('does not take other errors for a lost connection', () => {
    expect(isIpcConnectionLost({ type: 'connect' })).toBe(false);
    expect(isIpcConnectionLost({ type: 'ipc', objectNotFound: true })).toBe(false);
    expect(isIpcConnectionLost({ type: 'file', notFound: true })).toBe(false);
    expect(isIpcConnectionLost(new Error('x'))).toBe(false);
    expect(isIpcConnectionLost(undefined)).toBe(false);
  });
});
