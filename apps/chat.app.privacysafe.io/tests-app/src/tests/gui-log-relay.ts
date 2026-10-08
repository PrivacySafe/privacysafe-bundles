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

import { itCond } from '../libs-for-tests/jasmine-utils.js';
import {
  makeLogRelayBuffer,
  shouldRelayLogs,
  stringifyLogDetails,
  type GuiLogLine,
} from '../../../shared-libs/log-relay.js';

describe(`Logs of the windows, on their way to the background`, () => {

  function line(msg: string): GuiLogLine {
    return { level: 'info', line: msg };
  }

  itCond(`hands over everything buffered, in the order it was written`, async () => {
    const buffer = makeLogRelayBuffer(10);
    buffer.add(line('first'));
    buffer.add(line('second'));

    expect(buffer.size).toBe(2);
    expect(buffer.take().map(l => l.line)).toEqual(['first', 'second']);
    expect(buffer.size)
      .withContext(`taking empties the buffer, so nothing is sent twice`)
      .toBe(0);
    expect(buffer.take())
      .withContext(`and an empty buffer sends nothing at all`)
      .toEqual([]);
  }, 5000);

  itCond(`drops the oldest lines past its bound, and says how many`, async () => {
    // Bounded because this is diagnostics: a window whose relay cannot reach
    // the background - it is starting up, or the connection is gone - must not
    // grow a queue in its place.
    const buffer = makeLogRelayBuffer(3);
    for (const msg of ['1', '2', '3', '4', '5']) {
      buffer.add(line(msg));
    }

    const taken = buffer.take();

    expect(taken.map(l => l.line).slice(1))
      .withContext(`the newest lines are the ones kept`)
      .toEqual(['3', '4', '5']);
    expect(taken[0].line)
      .withContext(`a gap in the log has to read as a gap, not as silence`)
      .toContain('2 log line(s) dropped');
    expect(buffer.take())
      .withContext(`and the count is not repeated on the next batch`)
      .toEqual([]);
  }, 5000);

  itCond(`keeps an error's stack, and never throws on odd details`, async () => {
    const err = new Error('something went wrong');

    expect(stringifyLogDetails(err))
      .withContext(`an error line without a stack is the half that says nothing`)
      .toContain('something went wrong');
    expect(stringifyLogDetails({ type: 'fs-sync', path: 'x' }))
      .toBe('{"type":"fs-sync","path":"x"}');
    expect(stringifyLogDetails(undefined)).toBeUndefined();

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => stringifyLogDetails(cyclic))
      .withContext(`a logger must not fail on what it is asked to log`)
      .not.toThrow();
  }, 5000);

  itCond(`runs on the test stand only`, async () => {
    // In a production run each window's own logToPlatform already puts these
    // lines into the platform's log file, so the relayed copy is a duplicate -
    // and a duplicate that the background component writes out one awaited
    // w3n.log at a time, into the channel its main thread was found blocked in
    // when it froze mid-call on 2026-09-11.
    expect(shouldRelayLogs({ testStand: {} }))
      .withContext(`the stand is the one place the three streams are read as one`)
      .toBeTrue();
    expect(shouldRelayLogs({}))
      .withContext(`a production run gets no testStand from the platform`)
      .toBeFalse();
    expect(shouldRelayLogs(undefined)).toBeFalse();
    expect(shouldRelayLogs(w3n as { testStand?: unknown }))
      .withContext(`and these specs themselves run on the stand`)
      .toBeTrue();
  }, 5000);

});
