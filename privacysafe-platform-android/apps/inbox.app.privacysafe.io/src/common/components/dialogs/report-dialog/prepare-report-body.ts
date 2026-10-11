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
import dayjs from 'dayjs';
import escape from 'lodash/escape';
import type { IncomingMessageView } from '@common/types';
import { REASONS_MAP } from './constants';

export type ReportTranslate = (key: string, placeholders?: Record<string, string>) => string;

export interface ReportBodyParams {
  message: IncomingMessageView;
  reasons: string[];
  additionalDetails: string;
  includeMessage: boolean;
  attachedNames: string[];
  failedNames: string[];
  t: ReportTranslate;
}

export const REPORTED_MSG_DATE_FORMAT = 'YYYY-MM-DD HH:mm';

export function formatReportedMsgDate(message: IncomingMessageView): string {
  const ts = message.deliveryTS || message.cTime;
  return ts ? dayjs(ts).format(REPORTED_MSG_DATE_FORMAT) : '';
}

export function reasonsToText(reasons: string[], t: ReportTranslate): string {
  return Object.keys(REASONS_MAP)
    .filter(key => reasons.includes(key))
    .map(key => t(REASONS_MAP[key]).toLowerCase())
    .join(', ');
}

export function prepareReportMsgBody({
  message,
  reasons,
  additionalDetails,
  includeMessage,
  attachedNames,
  failedNames,
  t,
}: ReportBodyParams): string {
  const sentAt = formatReportedMsgDate(message);
  const parts: string[] = [
    `<div>${t('dialog.report-dialog.content.step2Preamble')}</div>`,
    `<br/>`,
    `<div>${t('dialog.report-dialog.content.reason.label')}: ${reasonsToText(reasons, t)}</div>`,
    `<div>${t('dialog.report-dialog.content.reportedSender')}: ${escape(message.sender)}</div>`,
    `<div>${t('dialog.report-dialog.content.reportedReceivedAt')}: ${sentAt}</div>`,
    `<div>${t('dialog.report-dialog.content.reportedMsgId')}: ${escape(message.msgId)}</div>`,
  ];

  const details = additionalDetails.trim();
  if (details) {
    parts.push(
      `<br/>`,
      `<div>${t('dialog.report-dialog.content.step2Additional')}:</div>`,
      `<div>${escape(details).replaceAll('\n', '<br/>')}</div>`,
    );
  }

  if (includeMessage) {
    const quoted = message.htmlTxtBody || escape(message.plainTxtBody || '').replaceAll('\n', '<br/>');
    parts.push(
      `<br/><br/>`,
      `<div>---------- ${t('dialog.report-dialog.content.reportedMessageTitle')} ----------</div>`,
      `<div>${sentAt}</div>`,
      `<div>${t('msg.create.label.from')}: ${escape(message.sender)}</div>`,
      `<div>${t('msg.create.label.to')}: ${escape((message.recipients || []).join(', '))}</div>`,
      `<div>${t('msg.create.label.subject')}: ${escape(message.subject || '')}</div>`,
      `<blockquote>${quoted}</blockquote>`,
    );
  }

  if (attachedNames.length > 0) {
    parts.push(
      `<br/>`,
      `<div>${t('dialog.report-dialog.content.attachmentsNote')}</div>`,
      `<ul>${attachedNames.map(name => `<li>${escape(name)}</li>`).join('')}</ul>`,
    );
  }

  if (failedNames.length > 0) {
    parts.push(
      `<br/>`,
      `<div>${t('dialog.report-dialog.content.attachmentsFailed', { files: escape(failedNames.join(', ')) })}</div>`,
    );
  }

  return parts.join('\n');
}
