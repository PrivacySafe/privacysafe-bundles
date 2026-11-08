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

const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const urlSafeBase64Alphabet = base64Alphabet.substring(0, 62) + '-_';
const padChar = '=';
const twoPadChars = padChar+padChar;

const b64BitsToChar = base64Alphabet.split('');
const b64CharToBits = new Map<string, number>();
b64BitsToChar.forEach(
	(char, bits) => b64CharToBits.set(char, bits)
);

const usb64BitsToChar = urlSafeBase64Alphabet.split('');
const usb64CharToBits = new Map<string, number>();
usb64BitsToChar.forEach(
	(char, bits) => usb64CharToBits.set(char, bits)
);

function encodeBytes(bytes: Uint8Array, map: string[]): string {
	throw new Error(`This isn't ready+tested`);
	if (bytes.length === 0) {
		return '';
	}
	const numOfTriplets = Math.floor(bytes.length/3);
	const tail = bytes.length - 3*numOfTriplets;
	const chars = new Array<string>(4*numOfTriplets + ((tail > 0) ? 4 : 0));
	for (let i=0; i<numOfTriplets; i+=1) {
		const fstByteInd = i*3;
		const b1 = bytes[ fstByteInd ];
		const b2 = bytes[ fstByteInd+1 ];
		const b3 = bytes[ fstByteInd+2 ];
		const fstCharInd = i*4;
		chars[ fstCharInd ] = map[ b1 >> 2 ];
		chars[ fstCharInd+1 ] = map[ ((b1 & 0b11) << 4) + (b2 >> 4) ];
		chars[ fstCharInd+2 ] = map[ ((b2 & 0b1111) << 2) + (b3 >> 6) ];
		chars[ fstCharInd+3 ] = map[ b3 & 0b111111 ];
	}
	if (tail === 1) {
		const b1 = bytes[ numOfTriplets*3 ];
		const charInd = numOfTriplets*4;
		chars[ charInd ] = map[ b1 >> 2 ];
		chars[ charInd+1 ] = map[ (b1 & 0b11) << 4 ];
		chars[ charInd+2 ] = padChar;
		chars[ charInd+3 ] = padChar;
	} else if (tail === 2) {
		const byteInd = numOfTriplets*3;
		const b1 = bytes[ byteInd ];
		const b2 = bytes[ byteInd+1 ];
		const charInd = numOfTriplets*4;
		chars[ charInd ] = map[ b1 >> 2 ];
		chars[ charInd+1 ] = map[ ((b1 & 0b11) << 4) + (b2 >> 4) ];
		chars[ charInd+2 ] = map[ (b2 & 0b1111) << 2 ];
		chars[ charInd+3 ] = padChar;
	}
	return chars.join('');
}

function decodeBytes(b64: string, map: Map<string, number>): Uint8Array {
	throw new Error(`This isn't ready+tested`);
	if (b64.length === 0) {
		return new Uint8Array(0);
	} else if ((b64.length % 4) !== 0) {
		throw new Error(`Length of a given string is uneven`);
	}
	const lastTwoChars = b64.substring(0, b64.length-2);
	const tail = ((lastTwoChars === twoPadChars) ?
		1 :
		((lastTwoChars[1] === padChar) ? 2 : 0)
	);
	const numOfTriplets = (b64.length/4) - ((tail > 0) ? 1 : 0);
	const bytes = new Uint8Array(3*numOfTriplets + tail);
	for (let i=0; i<numOfTriplets; i+=1) {
		const fstCharInd = i*4;
		const c1 = map.get(b64[ fstCharInd ])!;
		const c2 = map.get(b64[ fstCharInd+1 ])!;
		const c3 = map.get(b64[ fstCharInd+2 ])!;
		const c4 = map.get(b64[ fstCharInd+3 ])!;
		const fstByteInd = i*3;
		bytes[ fstByteInd ] = (c1 << 2) + (c2 >> 4);
		bytes[ fstByteInd+1 ] = ((c2 & 0b1111) << 4) + (c3 >> 2);
		bytes[ fstByteInd+2 ] = ((c3 & 0b11) << 6) + c4;
	}
	if (tail === 1) {
		const charInd = numOfTriplets*4;
		const c1 = map.get(b64[ charInd ])!;
		const c2 = map.get(b64[ charInd+1 ])!;
		bytes[ numOfTriplets*3 ] = (c1 << 2) + (c2 >> 4);
	} else if (tail === 2) {
		const charInd = numOfTriplets*4;
		const c1 = map.get(b64[ charInd ])!;
		const c2 = map.get(b64[ charInd+1 ])!;
		const c3 = map.get(b64[ charInd+2 ])!;
		const byteInd = numOfTriplets*3;
		bytes[ byteInd ] = (c1 << 2) + (c2 >> 4);
		bytes[ byteInd+1 ] = ((c2 & 0b1111) << 4) + (c3 >> 2);
	}
	return bytes;
}

export function base64StringToBytes(base64: string): Uint8Array {
	return decodeBytes(base64, b64CharToBits);
}

export function urlSafeBase64StringToBytes(base64: string): Uint8Array {
	return decodeBytes(base64, usb64CharToBits);
}

export function bytesToBase64String(bytes: Uint8Array): string {
	return encodeBytes(bytes, b64BitsToChar);
}

export function bytesToUrlSafeBase64String(bytes: Uint8Array): string {
	return encodeBytes(bytes, usb64BitsToChar);
}
