import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLogger, setDebugLogging, setLogUserAddress } from '../../../shared/utils/logger.ts';

// The lines must reach w3n.log: only then the platform writes them into
// util/logs/<date>.files.app.privacysafe.io.log.txt.
const w3nLog = () => (w3n as unknown as { log: ReturnType<typeof vi.fn> }).log;

describe('makeLogger', () => {
  beforeEach(() => w3nLog().mockClear());

  afterEach(() => {
    setDebugLogging(false);
    setLogUserAddress('');
  });

  it('writes the line with its time, user address and scope to the platform log', () => {
    setLogUserAddress('user@example.com');
    const err = new Error('boom');

    makeLogger('SyncService').error('Upload failed. ', err);

    expect(w3nLog()).toHaveBeenCalledWith(
      'error',
      expect.stringMatching(/^\d{2}:\d{2}:\d{2}\.\d{3} \[user@example\.com\] \[SyncService\] Upload failed\. $/),
      err,
    );
  });

  it('maps warn to the platform warning level', () => {
    makeLogger('X').warn('careful');

    expect(w3nLog()).toHaveBeenCalledWith('warning', expect.stringContaining('[X] careful'), undefined);
  });

  it('writes debug lines only when diagnostics are on', () => {
    const log = makeLogger('X');

    log.debug('hidden');
    expect(w3nLog()).not.toHaveBeenCalled();

    setDebugLogging(true);
    log.debug('shown');
    expect(w3nLog()).toHaveBeenCalledWith('info', expect.stringContaining('[X] shown'), undefined);
  });

  it('does not throw when the platform log fails', () => {
    w3nLog().mockImplementationOnce(async () => {
      throw new Error('no log');
    });

    expect(() => makeLogger('X').info('line')).not.toThrow();
  });
});
