/*
 Copyright (C) 2024-2026 3NSoft Inc.

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

/* eslint-disable @typescript-eslint/no-explicit-any */

function sanitizeForLogging(err: unknown): unknown {
  if (err instanceof Error) {
    const errorObj: Record<string, unknown> = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    for (const key of Object.keys(err)) {
      errorObj[key] = (err as unknown as Record<string, unknown>)[key];
    }
    return errorObj;
  }
  if (typeof err === 'object' && err !== null) {
    try {
      JSON.stringify(err);
      return err;
    } catch {
      return String(err);
    }
  }
  return err;
}

export function setupGlobalReportingOfUnhandledErrors(
  skipDefaultHandling = false,
): void {
  self.onunhandledrejection = ev => {
    try {
      if (skipDefaultHandling && typeof ev?.preventDefault === 'function') {
        ev.preventDefault();
      }
      const reason = sanitizeForLogging(ev?.reason);
      if (typeof w3n !== 'undefined' && w3n?.log) {
        w3n.log('error', `Captured unhandled promise rejection/error event`, reason).catch(err => {
          console.error('Failed to log unhandled rejection via w3n.log:', err, 'Original reason:', reason);
        });
      } else {
        console.error('Captured unhandled promise rejection/error event:', reason);
      }
    } catch (err) {
      console.error('Error inside onunhandledrejection handler:', err, 'Original event:', ev);
    }
  };

  self.onerror = (ev, source, lineno, colno, error) => {
    try {
      if (skipDefaultHandling) {
        if (typeof (ev as any)?.preventDefault === 'function') {
          (ev as any).preventDefault();
        }
      }
      const rawError = error ?? (typeof ev === 'object' ? (ev as any)?.error ?? ev : ev);
      const errToReport = sanitizeForLogging(rawError);
      if (typeof w3n !== 'undefined' && w3n?.log) {
        w3n.log('error', `Captured unhandled error event`, errToReport).catch(logErr => {
          console.error('Failed to log unhandled error via w3n.log:', logErr, 'Original error:', errToReport);
        });
      } else {
        console.error('Captured unhandled error event:', errToReport);
      }
    } catch (err) {
      console.error('Error inside onerror handler:', err, 'Original event:', ev);
    }
  };
}
