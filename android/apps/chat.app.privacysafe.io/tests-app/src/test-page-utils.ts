/*
 Copyright (C) 2021 - 2022 3NSoft Inc.
 
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

declare const w3n: web3n.testing.CommonW3N;

export function addMsgToPage(msg: string): void {
	const outElem = document.getElementById('test-out') as HTMLDivElement|null;
	if (outElem) {
		const txt = document.createTextNode(msg);
		const p = document.createElement('p');
		p.appendChild(txt);
		outElem.appendChild(p);
	} else {
		console.error(`Element for test messages is not found to display following:`, msg);
	}
}

export function progressOnPage(p: number): void {
	const progressElem = document.getElementById(
		'keys-process') as HTMLProgressElement|null;
	if (progressElem) {
		progressElem.hidden = false;
		progressElem.value = p;
	} else {
		console.error(`Progress element is not found to display percent:`, p);
	}
}

export async function logErr(msg: string, err?: any): Promise<any> {
	w3n.testStand.log('error', msg, err);
	addMsgToPage(msg);
	if (err) {
		return err;
	} else {
		return Error(msg);
	}
}

export async function logInfo(msg: string): Promise<void> {
	w3n.testStand.log('info', msg);
	addMsgToPage(msg);
}

export interface ClosingParams {
	waitSecs: number;
}
export function jsonFromBytes(bytes: Uint8Array): any {
	return JSON.parse(strFromBytes(bytes));
}

export function jsonToBytes(json: any): Uint8Array {
	return strToBytes(JSON.stringify(json));
}

export function strToBytes(str: string): Uint8Array {
	const enc = new TextEncoder();
	return enc.encode(str);
}

export function strFromBytes(bytes: Uint8Array): string {
	const dec = new TextDecoder();
	return dec.decode(bytes);
}
