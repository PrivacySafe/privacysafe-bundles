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
import { hasSpoofingCharacters } from '@shared/utils/fs-utils/entity-name';

/**
 * Extensions the operating system runs, or hands to something that runs code,
 * when such a file is opened. Opening a file goes to the OS default handler, so
 * a synced or shared `invoice.pdf.command` is one double click from running.
 * The list is the one of the Inbox and Chat apps.
 */
const RISKY_EXTENSIONS = new Set([
  // macOS
  'app', 'command', 'tool', 'pkg', 'mpkg', 'scpt', 'scptd', 'applescript', 'workflow', 'terminal',
  'webloc', 'inetloc', 'fileloc', 'dmg',
  // Windows
  'exe', 'com', 'scr', 'pif', 'msi', 'msp', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse',
  'wsf', 'wsh', 'hta', 'cpl', 'lnk', 'url', 'reg', 'inf', 'scf', 'chm', 'appref-ms', 'msc', 'gadget',
  // Linux and cross-platform
  'sh', 'bash', 'zsh', 'csh', 'ksh', 'run', 'bin', 'desktop', 'appimage', 'deb', 'rpm', 'jar', 'py',
  'pl', 'rb', 'php', 'apk',
  // Documents that run script
  'html', 'htm', 'xhtml', 'svg', 'shtml', 'mht', 'mhtml', 'docm', 'xlsm', 'pptm',
]);

/**
 * True when opening the file may run code, or when its name hides what it is:
 * direction overrides make 'invoice‮fdp.exe' look like 'invoiceexe.pdf'.
 * Trailing dots and spaces are ignored, as Windows ignores them.
 */
export function isRiskyFileName(name: string | undefined): boolean {
  if (!name) {
    return false;
  }
  if (hasSpoofingCharacters(name)) {
    return true;
  }
  const trimmed = name.replace(/[.\s]+$/, '');
  const dot = trimmed.lastIndexOf('.');
  return dot >= 0 && RISKY_EXTENSIONS.has(trimmed.substring(dot + 1).trim().toLowerCase());
}
