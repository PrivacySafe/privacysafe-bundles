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
// What the user is told about files an archive does not carry.
//
// A bare count is not enough: the reasons differ in what the user can do about
// them - one of them is "take the backup on the device the files are on" - so
// they are counted and named apart. One mapping for all three places the same
// fact is told: the creation dialog, the notice after a backup, and the restore
// dialog.
import type { OmittedAttachmentReason, SkippedAttachment } from '~/backup.types';

/** Reason → the i18n key of the line that explains it. */
const reasonTextKey: Record<OmittedAttachmentReason, string> = {
  'on-another-device': 'backup.skipped.onAnotherDevice',
  'not-requested': 'backup.skipped.notRequested',
  symlink: 'backup.skipped.symlink',
  'in-incoming-msg': 'backup.skipped.inIncomingMsg',
  unreadable: 'backup.skipped.unreadable',
  'folder-partial': 'backup.skipped.folderPartial',
  'no-local-source': 'backup.skipped.noLocalSource',
};

/**
 * The order the reasons are told in: the one the user can act on first.
 *
 * `in-incoming-msg` is last because it is not a shortcoming of the archive but
 * the boundary of what one can hold - and the creation dialog says so in a line
 * of its own.
 */
const reasonOrder: OmittedAttachmentReason[] = [
  'on-another-device',
  'not-requested',
  'symlink',
  'unreadable',
  'folder-partial',
  'no-local-source',
  'in-incoming-msg',
];

export type Translate = (key: string, named?: Record<string, unknown>) => string;

export interface SkippedAttachmentsSummary {
  total: number;
  byReason: Array<{ reason: OmittedAttachmentReason; count: number }>;
}

export function summarizeSkippedAttachments(
  skipped: SkippedAttachment[] | undefined,
): SkippedAttachmentsSummary {
  const counts = new Map<OmittedAttachmentReason, number>();
  for (const item of skipped ?? []) {
    counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  }

  return {
    total: skipped?.length ?? 0,
    byReason: reasonOrder
      .filter(reason => counts.has(reason))
      .map(reason => ({ reason, count: counts.get(reason)! })),
  };
}

/**
 * One line per reason, each naming what to do about it. Empty when the archive
 * left nothing out.
 */
export function skippedAttachmentsLines(
  skipped: SkippedAttachment[] | undefined,
  t: Translate,
): string[] {
  return summarizeSkippedAttachments(skipped).byReason.map(
    ({ reason, count }) => t(reasonTextKey[reason], { count }),
  );
}
