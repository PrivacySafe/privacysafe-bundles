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
export const styleByStatus: Record<
  web3n.files.SyncState | 'remote',
  { icon: string; iconColor: string; color: string }
> = {
  unsynced: {
    icon: 'round-info',
    iconColor: 'var(--color-icon-control-secondary-default)',
    color: 'var(--color-text-control-secondary-default)',
  },
  synced: {
    icon: 'round-check-circle',
    iconColor: 'var(--success-content-default)',
    color: 'var(--success-content-default)',
  },
  behind: {
    icon: 'round-warning',
    iconColor: 'var(--color-icon-control-warning-default)',
    color: 'var(--color-text-control-warning-default)',
  },
  conflicting: {
    icon: 'round-info',
    iconColor: 'var(--error-content-default)',
    color: 'var(--error-content-default)',
  },
  remote: {
    icon: 'cloud-off-rounded',
    iconColor: 'var(--color-icon-control-primary-default)',
    color: 'var(--color-text-control-primary-default)',
  },
};
