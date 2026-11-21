/*
 Copyright (C) 2025 3NSoft Inc.

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

export type UnicodeRanges = readonly { first: number; last: number; }[];

export const strictASCiiForUsername = Object.freeze([
	// values from https://www.unicode.org/charts/PDF/U0000.pdf
	{ first: 0x2D, last: 0x2E },	// - to .
	{ first: 0x30, last: 0x39 },	// 0 to 9
	{ first: 0x41, last: 0x5A },	// A to Z
	{ first: 0x5F, last: 0x5F },	// _
	{ first: 0x61, last: 0x7A },	// a to z
] as UnicodeRanges);

export const strictASCiiForPassword = Object.freeze([
	// values from https://www.unicode.org/charts/PDF/U0000.pdf
	{ first: 0x21, last: 0x21 },	// !
	{ first: 0x23, last: 0x26 },	// # to &
	{ first: 0x28, last: 0x2B },	// ( to +
	{ first: 0x2D, last: 0x2E },	// - to .
	{ first: 0x30, last: 0x3B },	// 0 to ;
	{ first: 0x3F, last: 0x5A },	// ? to Z
	{ first: 0x5E, last: 0x5F },	// ^ to _
	{ first: 0x61, last: 0x7A },	// a to z
	{ first: 0x7E, last: 0x7E },	// ~
] as UnicodeRanges);
