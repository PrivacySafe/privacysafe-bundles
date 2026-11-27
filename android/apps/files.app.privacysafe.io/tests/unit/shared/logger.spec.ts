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

// Security audit 2026-11: a name with a line break, coming from another device, forged log lines.
describe('makeLogger: one line per call', () => {
  beforeEach(() => w3nLog().mockClear());

  it('escapes line breaks and control characters of the message', () => {
    makeLogger('X').error("Error deleting 'a\n12:00:00.000 [Y] fake\r\u0007'. ");

    const line = w3nLog().mock.calls[0][1] as string;
    expect(line).not.toContain('\n');
    expect(line).not.toContain('\r');
    expect(line).not.toContain('\u0007');
    expect(line).toContain("'a\\n12:00:00.000 [Y] fake\\r\\u0007'");
  });
});
