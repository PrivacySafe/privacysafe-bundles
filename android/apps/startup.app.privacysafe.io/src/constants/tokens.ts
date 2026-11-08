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

import silverImg from '@/assets/images/shield-silver.png';
import goldImg from '@/assets/images/shield-gold.png';
import platinumImg from '@/assets/images/shield-platinum.png';

export const tokens = {
  silver: {
    value: 'xzo6-aglb-qeuk-app-xyz',
    url: '',
    domain: 'privacysafe.xyz',
    assetsImage: silverImg
  },
  gold: {
    value: '',
    url: 'https://psafe.ly/psfgold',
    domain: 'privacysafe.me',
    assetsImage: goldImg
  },
  platinum: {
    value: '',
    url: 'https://psafe.ly/psfplat',
    domain: 'privacysafe.gg',
    assetsImage: platinumImg
  },
};
