/*
 Copyright (C) 2024 3NSoft Inc.
 
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

export function getOneMsgFromProcess<T>(
	userNum: number|undefined, appDomain: string|undefined,
	component: string|undefined,
	timeout = 4900
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let promiseCompleted = false;
		setTimeout(() => {
			if (!promiseCompleted) {
				promiseCompleted = true;
				reject(new Error(
					`Timeout in ${timeout/1000} seconds in getting messages from another local test process`
				));
			}
		}, timeout);
		const unsub = w3n.testStand.observeMsgsFromOtherLocalTestProcess(
			{
				next: msg => {
					if (!promiseCompleted) {
						promiseCompleted = true;
						resolve(msg);
					}
					unsub();
				},
				error: err => {
					if (!promiseCompleted) {
						promiseCompleted = true;
						reject(err);
					}
				},
				complete: () => {
					if (!promiseCompleted) {
						promiseCompleted = true;
						reject(new Error(
							`Observation of messages from another local test process completed without any messages`
						));
					}
				}
			},
			userNum, appDomain, component
		);
	});
}

export function getMsgsStreamFromProcess<T>(
	userNum: number|undefined, appDomain: string|undefined,
	component: string|undefined
): ReadableStream<T> {
	let unsub: () => void;
	return new ReadableStream<T>({
		start: async ctrl => {
			unsub = w3n.testStand.observeMsgsFromOtherLocalTestProcess(
				{
					next: (msg: T) => ctrl.enqueue(msg),
					error: err => {
						ctrl.error(err);
						ctrl.close();
					},
					complete: () => ctrl.close()
				},
				userNum, appDomain, component
			);
		},
		cancel: () => unsub()
	}) as ReadableStream<T> & AsyncIterable<T>;
}
