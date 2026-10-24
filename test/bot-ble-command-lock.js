'use strict';

// Run with: node test/bot-ble-command-lock.js
// Load the real driver with a minimal Homey stub; no radio or SDK is required.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../drivers/bot_ble/device.js'), 'utf8');
const driverModule = { exports: {} };
vm.runInNewContext(source, {
	module: driverModule,
	Error,
	Buffer,
	require: (name) =>
	{
		if (name === 'homey') return { Device: class {} };
		if (name === 'crc-32') return {};
		throw new Error(`Unexpected dependency: ${name}`);
	},
});
const BotBLEDevice = driverModule.exports;
const packet = [0x57, 0x01, 0x00];

function fixture(operate)
{
	const device = new BotBLEDevice();
	const calls = [];
	const delays = [];
	device.getName = () => 'test-bot';
	device.getData = () => ({ address: 'test-address' });
	device.sendingCommand = false;
	device.homey = { app: {
		bleBusy: false,
		updateLog: () => {},
		Delay: async (ms) => { delays.push(ms); },
	} };
	device._operateBotLoop = async (name, bytes) =>
	{
		assert.equal(device.sendingCommand, true);
		assert.equal(device.homey.app.bleBusy, true);
		assert.equal(bytes, packet);
		calls.push(name);
		return operate();
	};
	return { device, calls, delays };
}

function unlocked(device)
{
	assert.equal(device.sendingCommand, false);
	assert.equal(device.homey.app.bleBusy, false);
}

const tests = [];
function test(name, run) { tests.push({ name, run }); }

for (const [name, operate] of [
	['false status', () => ({ status: false })],
	['null response', () => null],
	['undefined response', () => undefined],
	['returned Error', () => new Error('BLE Timeout')],
	['thrown Error', () => { throw new Error('BLE Timeout'); }],
])
{
	test(`${name}: reject exhaustion and allow the next command`, async () =>
	{
		const { device, calls, delays } = fixture(operate);
		await assert.rejects(() => device._operateBot(packet), /BLE Timeout|without acknowledgement/);
		unlocked(device);
		assert.equal(calls.length, 5);
		assert.deepEqual(delays, [2000, 2000, 2000, 2000]);
		device._operateBotLoop = async () => ({ status: true });
		await device._operateBot(packet);
		unlocked(device);
	});
}

test('success releases both flags after one attempt', async () =>
{
	const { device, calls } = fixture(() => ({ status: true }));
	await device._operateBot(packet);
	assert.equal(calls.length, 1);
	unlocked(device);
});

test('a successful retry retains the existing retry count and delay', async () =>
{
	let count = 0;
	const { device, calls, delays } = fixture(() => ({ status: ++count === 5 }));
	await device._operateBot(packet);
	assert.equal(calls.length, 5);
	assert.deepEqual(delays, [2000, 2000, 2000, 2000]);
	unlocked(device);
});

test('the original thrown error is reported after retry exhaustion', async () =>
{
	const error = new Error('original BLE error');
	const { device } = fixture(() => { throw error; });
	await assert.rejects(() => device._operateBot(packet), (actual) => actual === error);
	unlocked(device);
});

test('BLEHub success releases only this command lock', async () =>
{
	const { device, calls } = fixture(() => ({ status: true }));
	device.homey.app.bleBusy = true;
	device.homey.app.BLEHub = { sendBLEHubCommand: async () => true };
	await device._operateBot(packet);
	assert.equal(calls.length, 0);
	assert.equal(device.sendingCommand, false);
	assert.equal(device.homey.app.bleBusy, true);
});

test('BLEHub exception releases the command lock and preserves another BLE owner', async () =>
{
	const { device, calls } = fixture(() => ({ status: true }));
	device.homey.app.bleBusy = true;
	device.homey.app.BLEHub = { sendBLEHubCommand: async () => { throw new Error('hub failed'); } };
	await assert.rejects(() => device._operateBot(packet), /hub failed/);
	assert.equal(calls.length, 0);
	assert.equal(device.sendingCommand, false);
	assert.equal(device.homey.app.bleBusy, true);
});

test('BLEHub false result still falls back to local BLE', async () =>
{
	const { device, calls } = fixture(() => ({ status: true }));
	device.homey.app.BLEHub = { sendBLEHubCommand: async () => false };
	await device._operateBot(packet);
	assert.equal(calls.length, 1);
	unlocked(device);
});

test('a concurrent call cannot clear the active command locks', async () =>
{
	let finish;
	const { device, calls } = fixture(() => new Promise((resolve) => { finish = resolve; }));
	const active = device._operateBot(packet);
	await assert.rejects(() => device._operateBot(packet), /Still sending previous command/);
	assert.equal(device.sendingCommand, true);
	assert.equal(device.homey.app.bleBusy, true);
	assert.equal(calls.length, 1);
	finish({ status: true });
	await active;
	unlocked(device);
});

test('logging failure after acquiring BLE cannot strand either flag', async () =>
{
	const { device } = fixture(() => ({ status: true }));
	device.homey.app.updateLog = () => { throw new Error('logging failed'); };
	await assert.rejects(() => device._operateBot(packet), /logging failed/);
	unlocked(device);
});

test('retry delay failure releases the command lock', async () =>
{
	const { device } = fixture(() => ({ status: false }));
	device.homey.app.Delay = async () => { throw new Error('delay failed'); };
	await assert.rejects(() => device._operateBot(packet), /delay failed/);
	unlocked(device);
});

test('failure while waiting for another BLE owner must preserve that owner', async () =>
{
	const { device, calls } = fixture(() => ({ status: true }));
	device.homey.app.bleBusy = true;
	device.homey.app.Delay = async () => { throw new Error('wait failed'); };
	await assert.rejects(() => device._operateBot(packet), /wait failed/);
	assert.equal(calls.length, 0);
	assert.equal(device.sendingCommand, false);
	assert.equal(device.homey.app.bleBusy, true);
});

(async () =>
{
	for (const { name, run } of tests)
	{
		await run();
		process.stdout.write(`PASS ${name}\n`);
	}
	process.stdout.write(`${tests.length} tests passed\n`);
})().catch((error) =>
{
	process.stderr.write(`${error.stack || error}\n`);
	process.exitCode = 1;
});
