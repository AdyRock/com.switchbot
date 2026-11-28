'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
	if (request === 'homey-oauth2app') return { OAuth2Device: class {} };
	return originalLoad.call(this, request, parent, isMain);
};
const Curtain = require('../drivers/curtains_hub/device');
Module._load = originalLoad;

function device(overrides = {}) {
	const values = {};
	const instance = Object.assign(Object.create(Curtain.prototype), {
		invertPosition: false, motionMode: 0xff, values,
		getData: () => ({ type: 'Curtain3' }), setAvailable: () => {},
		unsetWarning: async () => {}, error: () => {}, hasCapability: () => true,
		setCapabilityValue: async (key, value) => { values[key] = value; },
		homey: { app: { updateLog: () => {}, varToString: String, triggerPositionLessThan: async () => {}, triggerPositionGreaterThan: async () => {} } },
	}, overrides);
	return instance;
}

test('stationary calibrated near-close is normalized only after an exact close', async () => {
	const d = device({ _getHubDeviceValues: async () => ({ slidePosition: 99, moving: false, calibrate: true }) });
	await d.getHubDeviceValues();
	assert.equal(d.values.windowcoverings_set, 0.99);
	d.pendingCloseUntil = Date.now() + 10000;
	await d.getHubDeviceValues();
	assert.equal(d.values.windowcoverings_set, 1);
	assert.equal(d.values.position, 99);
	d.pendingCloseUntil = 0;
	await d.getHubDeviceValues();
	assert.equal(d.values.windowcoverings_set, 1);
});

test('moving or uncalibrated feedback does not establish the latch', async () => {
	for (const data of [{slidePosition: 99, moving: true, calibrate: true}, {slidePosition: 99, moving: false, calibrate: false}]) {
		const d = device({ pendingCloseUntil: Date.now() + 10000, _getHubDeviceValues: async () => data });
		await d.getHubDeviceValues();
		assert.equal(d.values.windowcoverings_set, 0.99);
	}
});

test('exact close intent is armed after success and an intentional one percent opening is not', async () => {
	const d = device({ _operateCurtain: async () => true });
	await d.onCapabilityPosition(0.99);
	assert.equal(d.pendingCloseUntil, undefined);
	await d.onCapabilityPosition(1);
	assert.ok(d.pendingCloseUntil > Date.now());
});

test('a poll overtaken by a command is ignored', async () => {
	let finish;
	const d = device({ commandSequence: 1, _getHubDeviceValues: () => new Promise(resolve => { finish = resolve; }) });
	const poll = d.getHubDeviceValues();
	d.commandSequence = 2;
	finish({ slidePosition: 99, moving: false, calibrate: true });
	await poll;
	assert.equal(d.values.windowcoverings_set, undefined);
});

test('webhook retains confirmed endpoint and preserves raw position', async () => {
	const d = device({
		closeEndpointLatched: true,
		getData: () => ({ id: 'test', type: 'Curtain3' }),
		homey: { setTimeout: () => 1, app: { updateLog: () => {}, varToString: String,
			triggerPositionLessThan: async () => {}, triggerPositionGreaterThan: async () => {} } },
	});
	await d.processWebhookMessage({ context: { deviceMac: 'test', slidePosition: 99 } });
	assert.equal(d.values.windowcoverings_set, 1);
	assert.equal(d.values.position, 99);
});

test('inverted feedback normalizes only the logical closed endpoint', async () => {
	const d = device({ invertPosition: true, pendingCloseUntil: Date.now() + 10000,
		_getHubDeviceValues: async () => ({ slidePosition: 1, moving: false, calibrate: true }) });
	await d.getHubDeviceValues();
	assert.equal(d.values.windowcoverings_set, 1);
	assert.equal(d.values.position, 99);
});

test('rejected and non-Curtain3 commands cannot arm tolerance', async () => {
	const rejected = device({ _operateCurtain: async () => { throw new Error('rejected'); } });
	await assert.rejects(rejected.onCapabilityPosition(1), /rejected/);
	assert.equal(rejected.pendingCloseUntil, undefined);
	const other = device({ getData: () => ({ type: 'Curtain' }), _operateCurtain: async () => true });
	await other.onCapabilityPosition(1);
	assert.equal(other.pendingCloseUntil, undefined);
});

test('a newer command prevents old close acknowledgement from arming tolerance', async () => {
	let finish;
	const d = device({ commandSequence: 1, _operateCurtain: () => new Promise(resolve => { finish = resolve; }) });
	const pending = d.onCapabilityPosition(1);
	d.commandSequence = 2;
	finish(true);
	await pending;
	assert.equal(d.pendingCloseUntil, undefined);
});
