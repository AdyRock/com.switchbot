'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../drivers/ai_hub/device.js'), 'utf8');
const deviceModule = { exports: {} };
vm.runInNewContext(source, {
	module: deviceModule,
	Error,
	require: (name) =>
	{
		if (name === '../hub_device') return class {};
		throw new Error(`Unexpected dependency: ${name}`);
	},
});
const AIHubDevice = deviceModule.exports;

function fixture(status)
{
	const device = new AIHubDevice();
	const calls = { values: {}, warnings: [], logs: [] };
	device._getHubDeviceValues = async () => ({ onlineStatus: status });
	device.setAvailable = async () => {};
	device.setCapabilityValue = async (capability, value) =>
	{
		calls.values[capability] = value;
	};
	device.setWarning = async (warning) =>
	{
		calls.warnings.push(warning);
	};
	device.error = (err) => { throw err; };
	device.homey = {
		app: {
			updateLog: (message) => calls.logs.push(message),
		},
	};
	return { device, calls };
}

async function run()
{
	for (const [status, expectedAlarm] of [['online', false], ['offline', true]])
	{
		const { device, calls } = fixture(status);
		await device.getHubDeviceValues();
		assert.equal(calls.values.alarm_generic, expectedAlarm);
		assert.equal(calls.warnings.length, 0);
	}

	const invalid = fixture('unknown');
	await invalid.device.getHubDeviceValues();
	assert.equal(Object.keys(invalid.calls.values).length, 0);
	assert.match(invalid.calls.warnings[0], /Unexpected AI Hub online status/);

	const polled = fixture('online');
	assert.equal(await polled.device.pollHubDeviceValues(), true);
	assert.equal(polled.calls.values.alarm_generic, false);
}

run().catch((err) =>
{
	console.error(err);
	process.exitCode = 1;
});
