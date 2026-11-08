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

/**
 * Getting the window to the point where the app can be mounted - and saying
 * so on screen when it cannot.
 *
 * Shared by both form factors deliberately: desktop and mobile differ only in
 * the root element and what they mount, and the interesting part here (what
 * happens when the background component does not answer) is exactly the part
 * that must not drift between them.
 */

import { wrapWithTimeout } from '@shared/processes/timeouts';
import { makeLogger } from '@shared/logger';
import i18n from '@main/common/data/i18';
import { initializeServices } from '@main/common/services/external-services';
import { CONNECT_TIMEOUT_MILLIS } from '@main/common/services/backend-availability';
import {
  clearStartupOverlay,
  showStartupFailure,
  showStartupProgress,
} from '@main/common/services/startup-failure-screen';

const log = makeLogger('MainWindow');

function t(key: string): string {
  return i18n.global.t(key);
}

/**
 * Connects to this app's services and hands control back to mount the app.
 *
 * The connect gets a timeout of its own, and its failure gets a screen. Both
 * are new: the barrier used to be a bare promise whose rejection only reached
 * the log, leaving an animated splash on screen with nothing said anywhere
 * the user could see it.
 *
 * Note what this timeout does NOT protect against: a connect that succeeds
 * against a component that has stopped answering. Nothing here can - the
 * handshake is answered by a facade that exists before the service does. That
 * case is caught by the first real call instead (see callBackend and
 * app.store's initialize()).
 */
export async function startMainWindow(
  rootId: string, mountApp: () => void,
): Promise<void> {
  showStartupProgress(rootId, t('app.startup.starting'));
  try {
    await wrapWithTimeout(
      initializeServices(),
      CONNECT_TIMEOUT_MILLIS,
      () => Error(`Connecting to this app's services timed out`),
    );
  } catch (err) {
    log.error(`App is not started, as its services could not be reached`, err);
    showStartupFailure(rootId, {
      title: t('app.startup.unreachableTitle'),
      details: t('app.startup.connectFailedText'),
      onRetry: () => location.reload(),
      onClose: () => w3n.closeSelf!(),
    });
    return;
  }
  clearStartupOverlay(rootId);
  mountApp();
}
