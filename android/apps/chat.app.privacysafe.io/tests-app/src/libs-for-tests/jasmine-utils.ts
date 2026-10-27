/*
 Copyright (C) 2016 - 2018, 2020 - 2021, 2025 3NSoft Inc.
 
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

import { stringifyErr } from "../lib-common/exceptions/error.js";
import { callWithTimeout } from "../lib-common/processes/timeouts.js";
import { sleep } from "@shared/processes/sleep";

declare const w3n: web3n.testing.CommonW3N;

/**
 * Marks the running spec pending, with a reason that says what could not be
 * reached. Used instead of failing when a spec could not run at all because a
 * server was unreachable: a failure there reads like a defect in the app, and
 * has already sent one investigation down the wrong path.
 *
 * The reason goes to the test stand's log, which is printed to the run's
 * console, because the reporter records only a pending spec's name
 * (see public/jasmine/boot1.js). console.log is added for the window's
 * devtools, which is the only place it shows up.
 */
export function pendingBecauseUnreachable(what: string, detail?: string): never {
	const reason = `${what} is unreachable, so this spec cannot run.${
		detail ? ` ${detail}` : ''} Look for 'Cannot connect' / 'ETIMEDOUT' in the run log.`;
	console.log(`\n>>> SKIPPED: ${reason}`);
	w3n.testStand.log('info', `Spec skipped: ${reason}`);
	pending(reason);
	// pending() throws, so this is only here to type the function as `never`.
	throw new Error(reason);
}

/**
 * Whether this is the platform reporting that it could not reach a server, as
 * opposed to the server answering with a refusal. `type: 'connect'` covers
 * timeouts, DNS failures and refused connections alike.
 */
export function isConnectivityFailure(err: unknown): boolean {
	const exc = err as web3n.ConnectException | undefined;
	return !!exc?.runtimeException && (exc.type === 'connect');
}

/**
 * Finds a connect exception anywhere inside a thrown value. App code wraps
 * platform exceptions - a chat-creation exception carries them in
 * failedAddresses[].exc, runtime exceptions and native Errors in cause,
 * DeliveryProgress in recipients[*].err - and a spec that gets such a wrapper
 * is still looking at a network outage, not at a defect. Walking every
 * enumerable field, instead of a list of known wrapper shapes, keeps this the
 * single place that needs no updating when the next wrapper appears.
 */
export function findConnectivityFailure(err: unknown): web3n.ConnectException | undefined {
	return searchForConnectExc(err, new Set(), 8);
}

function searchForConnectExc(
	val: unknown, seen: Set<unknown>, depthLeft: number
): web3n.ConnectException | undefined {
	if (!val || (typeof val !== 'object') || seen.has(val) || (depthLeft <= 0)) {
		return undefined;
	}
	seen.add(val);
	if (isConnectivityFailure(val)) {
		return val as web3n.ConnectException;
	}
	// Error's own fields (message, cause) are not enumerable, so they are
	// picked out explicitly; Object.values() covers plain exception objects
	// and arrays alike.
	const inner = (val instanceof Error) ? [ val.cause ] : Object.values(val);
	for (const item of inner) {
		const found = searchForConnectExc(item, seen, depthLeft - 1);
		if (found) {
			return found;
		}
	}
	return undefined;
}

/**
 * For specs that catch and inspect exceptions themselves: rethrows the given
 * error when a connect exception is found inside it, letting itCond's guard
 * turn it into a pending spec. Without this, a spec's own catch block reads a
 * network outage as the failure it was expecting and passes (or fails) on
 * wrong grounds. A pending signal is rethrown for the same reason: an
 * operation wrapped in skipSpecIfUnresponsive may have already turned an
 * outage into pending(), and that must reach jasmine, not the spec's asserts.
 */
export function rethrowIfConnectivityFailure(err: unknown): void {
	if (isPendingSignal(err) || findConnectivityFailure(err)) {
		throw err;
	}
}

const UNRESPONSIVE = {};

/**
 * Runs an operation that needs a server, and skips the spec if it does not come
 * back in time or cannot reach that server.
 *
 * For operations that, without connectivity, neither fail nor return - address
 * verification over ASMail, say. Left alone such a spec dies on jasmine's own
 * timeout, which reports "did not complete within 5000ms" and names no cause,
 * and no catch block can intercept that. The platform's `isOnline()` is no help
 * either: it reports being online while a particular server is unreachable
 * (measured - that is why this takes the operation's own silence as the signal).
 *
 * A connect exception out of the operation becomes the same skip. Letting it
 * through would have the spec assert on it - `expect(exc.someField).toBeTrue()`
 * on an exception that has no such field - and report a network outage as a
 * defect. Awaiting the operation here matters for the same reason: a rejection
 * that arrives after jasmine has moved on is attributed to whichever spec is
 * running by then, which is how an outage in these specs surfaced as a failure
 * in an unrelated one.
 */
export async function skipSpecIfUnresponsive<T>(
	what: string, millis: number, action: () => Promise<T>
): Promise<T> {
	try {
		return await callWithTimeout(action, millis, () => UNRESPONSIVE);
	} catch (err) {
		if (err === UNRESPONSIVE) {
			pendingBecauseUnreachable(what, `It did not respond within ${millis}ms.`);
		}
		const connectExc = findConnectivityFailure(err) as web3n.HTTPConnectException | undefined;
		if (connectExc) {
			pendingBecauseUnreachable(connectExc.url ?? what, stringifyErr(err));
		}
		throw err;
	}
}

export const EVENTS_WAIT_BEFORE_PROBE_MILLIS = 15000;
const SERVER_PROBE_MILLIS = 5000;

/**
 * Awaits an operation that, when servers are fine, completes well within the
 * given time - waiting for delivery events, say. If the time runs out, the
 * ASMail server is probed with a pre-flight call to a test user's address:
 * silence or a connect failure means the wait is a symptom of an outage, and
 * the spec is marked pending with that reason. A server that answers - with
 * any verdict - means the network is alive, so the waiting continues, and a
 * still-hanging operation dies on jasmine's own spec timeout as a genuine
 * failure. Spec timeouts must exceed the given millis plus the probe's
 * ~5 seconds for the skip to fire first.
 */
export async function skipSpecIfServerSilentDuring<T>(
	whileDoingWhat: string, millis: number, op: Promise<T>
): Promise<T> {
	const stillWaiting = {};
	const result = await Promise.race([ op, sleep(millis).then(() => stillWaiting) ]);
	if (result !== stillWaiting) {
		return result as T;
	}
	const probeAddr = await w3n.testStand.idOfTestUser(2);
	try {
		await callWithTimeout(
			() => w3n.mail!.delivery.preFlight(probeAddr), SERVER_PROBE_MILLIS,
			() => UNRESPONSIVE
		);
	} catch (err) {
		if ((err === UNRESPONSIVE) || findConnectivityFailure(err)) {
			pendingBecauseUnreachable(
				`the ASMail server (probed while ${whileDoingWhat})`,
				`The operation did not complete within ${millis}ms, and the server probe got no answer either.`
			);
		}
		// any verdict from the server means the network is alive
	}
	return op;
}

/**
 * Marks the spec pending because deliveries are failing, which the app itself
 * has already noticed.
 *
 * A phantom whose delivery the server refuses is returned to the journal for a
 * retry - that is the whole design - so rows waiting to be released again are
 * the app's own evidence of an outage. It is more reliable than probing: a
 * pre-flight call can succeed while `PUT /asmail/delivery/msg/meta` answers 500,
 * which is exactly what the server did on 2026-08-15.
 */
export function pendingBecauseDeliveriesFail(detail: string): never {
	const reason = `Deliveries are not completing, so this spec cannot run. ${detail} `
		+ `Look for 'failed delivery' and 'status":500' in the run log.`;
	console.log(`\n>>> SKIPPED: ${reason}`);
	w3n.testStand.log('info', `Spec skipped: ${reason}`);
	pending(reason);
	throw new Error(reason);
}

/**
 * Marks the spec pending when the ASMail server is not accepting deliveries.
 *
 * Distinct from skipSpecIfServerSilentDuring, which reads any answer - a
 * refusal included - as "the network is alive, so an operation still hanging is
 * a real failure". For a spec whose subject *is* a delivery finishing, a server
 * answering 500 disqualifies the run just as much as one that says nothing: the
 * app's correct behaviour then is to keep the change and send it again, and
 * that is not what such a spec measures.
 */
export async function skipSpecIfServerRefusesDelivery(
	whileDoingWhat: string
): Promise<void> {
	const probeAddr = await w3n.testStand.idOfTestUser(2);
	try {
		await callWithTimeout(
			() => w3n.mail!.delivery.preFlight(probeAddr), SERVER_PROBE_MILLIS,
			() => UNRESPONSIVE
		);
	} catch (err) {
		pendingBecauseUnreachable(
			`the ASMail server (probed while ${whileDoingWhat})`,
			`It refused a pre-flight call: ${stringifyErr(err)}`
		);
	}
}

/**
 * Awaits a promise the spec expects to reject, and returns the rejection
 * value, or undefined if the promise fulfilled. Meant for wrapping
 * skipSpecIfUnresponsive(): a plain `.then(fail, onErr)` or try/catch around
 * it also catches the pending signal that jasmine's pending() throws, and the
 * spec then asserts on that marker string instead of being skipped - that is
 * how a network outage got reported as "Expected undefined to be true". This
 * function rethrows the pending signal, so that it reaches jasmine.
 */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
		return undefined;
	} catch (err) {
		if (isPendingSignal(err)) {
			throw err;
		}
		return err;
	}
}

function isPendingSignal(err: unknown): boolean {
	return (typeof err === 'string') ?
		err.startsWith(PENDING_MARKER) :
		((err instanceof Error) && err.message.startsWith(PENDING_MARKER));
}

export function itCond(
	expectation: string, assertion?: () => Promise<void>, timeout?: number,
	setup?: { isUp: boolean; }
): void {
	if (assertion) {
		it(
			expectation,
			callbackFor(
				() => assertion().finally(() => {
					w3n.testStand.focusThisWindow?.();
				}),
				setup
			),
			timeout
		);
	} else {
		it(expectation);
	}
}

/**
 * How jasmine signals pending(): by throwing a *string* that starts with this
 * marker. It has to reach jasmine to mark the spec pending, so it must not be
 * turned into fail() the way an ordinary thrown string is - a spec that
 * deliberately skipped itself would otherwise be reported as a failure, with
 * its reason wrapped in "Failed: => marked Pending...".
 */
const PENDING_MARKER = '=> marked Pending';

function callbackFor(
	assertion: () => Promise<void>, setup: { isUp: boolean; }|undefined
): () => Promise<void> {
	return async () => {
		if (setup && !setup.isUp) {
			fail(`Test setup is not up`);
		} else {
			try {
				await assertion();
			} catch (err) {
				if (typeof err === 'string') {
					if (err.startsWith(PENDING_MARKER)) {
						throw err;
					}
					fail(err);
				} else {
					// A connect exception is looked for at any depth: app code
					// rethrows them wrapped (chat-creation's failedAddresses[].exc,
					// cause chains of runtime exceptions and native Errors), and any
					// of those means a server the spec needed could not be reached.
					// Nothing was proven about the app, so this is a skip and not a
					// failure. Only an HTTP failure names the address it could not
					// reach. A hang, as opposed to an exception, cannot be intercepted
					// here - it dies on jasmine's own timeout, which is what
					// skipSpecIfUnresponsive around network operations is for.
					const connectExc = findConnectivityFailure(err) as web3n.HTTPConnectException | undefined;
					if (connectExc) {
						pendingBecauseUnreachable(
							connectExc.url ?? `a ${connectExc.connectType} server the spec needs`,
							stringifyErr(err),
						);
					} else if ((err as web3n.RuntimeException).runtimeException) {
						fail(stringifyErr(err));
					} else {
						throw err;
					}
				}
			}
		}
	}
}

export function xitCond(
	expectation: string, assertion?: () => Promise<void>, timeout?: number,
	setup?: { isUp: boolean; }
): void {
	if (assertion) {
		xit(expectation, callbackFor(assertion, setup), timeout);
	} else {
		xit(expectation);
	}
}

export function fitCond(
	expectation: string, assertion?: () => Promise<void>, timeout?: number,
	setup?: { isUp: boolean; }
): void {
	if (assertion) {
		fit(expectation, callbackFor(assertion, setup), timeout);
	} else {
		fit(expectation);
	}
}

export function beforeAllWithTimeoutLog(
	action: () => Promise<void>, timeout?: number
): void {
	beforeAll(callbackWithTimeout(action, true, timeout, 'beforeAll'), timeout);
}

const DEFAULT_TIMEOUT_INTERVAL = 5000;

function callbackWithTimeout(
	action: () => Promise<void>, throwIfErr: boolean, timeout: number|undefined,
	actionType: string
): () => Promise<void> {
	const millisToSleep = ((timeout === undefined) ?
		DEFAULT_TIMEOUT_INTERVAL : timeout);
	const timeoutErr = {};
	return async () => {
		try {
			await callWithTimeout(action, millisToSleep - 5, () => timeoutErr);
		} catch (err) {
			if (err === timeoutErr) {
				console.log(`\n>>> timeout in ${actionType}: action hasn't completed in ${millisToSleep - 5} milliseconds`);
			} else if (throwIfErr) {
				if (typeof err === 'string') {
					fail(err);
				} else if ((err as web3n.RuntimeException).runtimeException) {
					fail(stringifyErr(err));
				} else {
					throw err;
				}
			}
		}
	};
}

export function beforeEachWithTimeoutLog(
	action: () => Promise<void>, timeout?: number
): void {
	beforeEach(callbackWithTimeout(
		action, true, timeout, 'beforeEach'), timeout);
}

// Adjust this static flag to hide/show errors thrown in afterXXX()
const throwErrorInAfter = false;

export function afterAllCond(
	action: () => Promise<void>, timeout?: number
): void {
	afterAll(callbackWithTimeout(
		action, throwErrorInAfter, timeout, 'afterAll'), timeout);
}

export function afterEachCond(
	action: () => Promise<void>, timeout?: number
): void {
	afterEach(callbackWithTimeout(
		action, throwErrorInAfter, timeout, 'afterEach'), timeout);
}
