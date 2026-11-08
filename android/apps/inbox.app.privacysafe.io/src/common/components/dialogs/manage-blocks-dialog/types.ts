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
import type { Ui3nDialogComponentProps, Ui3nDialogEvent } from '@v1nt1248/3nclient-lib';

export interface ManageBlocksDialogProps {
  isMobileMode?: boolean;
  dialogProps?: Ui3nDialogComponentProps<void>;
}

export interface ManageBlocksDialogEmits {
  (event: 'action', value: { event: Ui3nDialogEvent }): void;
}

/** One row of the list: a contact, or an address only ever met in a message. */
export interface BlockableRow {
  id: string;
  mail: string;
  displayName: string;
  isContact: boolean;
}
