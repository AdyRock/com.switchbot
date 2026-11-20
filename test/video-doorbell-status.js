'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../drivers/video_doorbell/device.js'), 'utf8');
const deviceModule = { exports: {} };
vm.runInNewContext(source, {
	module: deviceModule,
	require: (name) =>
	{
		if (name === '../hub_device') return class {};
		throw new Error(`Unexpected dependency: ${name}`);
	},
});
const VideoDoorBellDevice = deviceModule.exports;

function fixture(status)
{
	const device = new VideoDoorBellDevice();
	const calls = { values: {}, warnings: [], logs: [] };
	device._getHubDeviceValues = async () => status;
	device.setAvailable = async () => {};
	device.setCapabilityValue = async (capability, value) =>
	{
		calls.values[capability] = value;
	};
	device.unsetWarning = async () => {};
	device.setWarning = async (warning) =>
	{
		calls.warnings.push(warning);
	};
	device.error = (err) => { throw err; };
	device.homey = {
		app: {
			updateLog: (message) => calls.logs.push(message),
			varToString: (value) => JSON.stringify(value),
		},
	};
	return { device, calls };
}

async function run()
{
	const withBattery = fixture({ battery: 84 });
	await withBattery.device.getHubDeviceValues();
	assert.equal(withBattery.calls.values.measure_battery, 84);
	assert.equal(withBattery.calls.warnings.length, 0);

	const emptyBattery = fixture({ battery: 0 });
	await emptyBattery.device.getHubDeviceValues();
	assert.equal(emptyBattery.calls.values.measure_battery, 0);

	const withoutBattery = fixture({});
	await withoutBattery.device.getHubDeviceValues();
	assert.equal(Object.prototype.hasOwnProperty.call(withoutBattery.calls.values, 'measure_battery'), false);
	assert.equal(withoutBattery.calls.warnings.length, 0);
}

run().catch((err) =>
{
	process.stderr.write(`${err.stack || err}\n`);
	process.exitCode = 1;
});
