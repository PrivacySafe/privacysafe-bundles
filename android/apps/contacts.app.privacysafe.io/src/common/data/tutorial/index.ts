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
import { router as desktopRouter } from '@main/desktop/router';
import { router as mobileRouter } from '@main/mobile/router';
import type { TutorialStep } from '@main/types';

export const DEFAULT_MOBILE_TUTORIAL_STEPS: TutorialStep[] = [
  {
    elQuery: '[data-tutorial="createBtn"]',
    text: 'tutorial.create',
    side: 'top',
    alignment: 'end',
    isRound: true,
  },
  {
    elQuery: '[data-tutorial="meListItem"]',
    text: 'tutorial.meListItem',
    side: 'top',
    alignment: 'start',
  },
  {
    elQuery: '[data-tutorial="appMenuBtn"]',
    text: 'tutorial.mobileMenuBtn',
    side: 'right',
    alignment: 'start',
    isRound: true,
    onNextAction: async () => {
      await mobileRouter.push({ query: { isMenuOpen: 'on' } });
    },
  },
  {
    elQuery: '[data-tutorial="make-backup"]',
    text: 'tutorial.make-backup',
    side: 'top',
    alignment: 'start',
  },
  {
    elQuery: '[data-tutorial="upload-backup"]',
    text: 'tutorial.upload-backup',
    side: 'top',
    alignment: 'start',
  },
  {
    elQuery: '[data-tutorial="tutorial"]',
    text: 'tutorial.repeat-tutorial',
    side: 'top',
    alignment: 'start',
    onNextAction: async () => {
      await mobileRouter.push({ query: { isMenuOpen: 'off' } });
    },
  },
];

export const DEFAULT_DESKTOP_TUTORIAL_STEPS: TutorialStep[] = [
  {
    elQuery: '[data-tutorial="createBtn"]',
    text: 'tutorial.create',
    side: 'right',
    alignment: 'start',
  },
  {
    elQuery: '[data-tutorial="meListItem"]',
    text: 'tutorial.meListItem',
    side: 'right',
    alignment: 'start',
  },
  {
    elQuery: '[data-tutorial="appMenuBtn"]',
    text: 'tutorial.mobileMenuBtn',
    side: 'right',
    alignment: 'start',
    isRound: true,
    onNextAction: async () => {
      await desktopRouter.push({ query: { isMenuOpen: 'on' } });
    },
  },
  {
    elQuery: '[data-tutorial="make-backup"]',
    text: 'tutorial.make-backup',
    side: 'left',
    alignment: 'start',
  },
  {
    elQuery: '[data-tutorial="upload-backup"]',
    text: 'tutorial.upload-backup',
    side: 'left',
    alignment: 'start',
  },
  {
    elQuery: '[data-tutorial="tutorial"]',
    text: 'tutorial.repeat-tutorial',
    side: 'left',
    alignment: 'start',
    onNextAction: async () => {
      await desktopRouter.push({ query: { isMenuOpen: 'off' } });
    },
  },
];
