'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../drivers/temperature_hub/device.js'), 'utf8');
const deviceModule = { exports: {} };
vm.runInNewContext(source, {
	module: deviceModule,
	require: (name) =>
	{
		if (name === '../hub_device') return class {};
		throw new Error(`Unexpected dependency: ${name}`);
	},
});
const TemperatureHubDevice = deviceModule.exports;

async function run()
{
	const device = new TemperatureHubDevice();
	const logs = [];
	device.getData = () => ({ id: 'meter-1' });
	device._getHubDeviceValues = async () => ({ temperature: 20, humidity: 50 });
	device.setAvailable = () => {};
	device.setCapabilityValue = async () => {};
	device.hasCapability = () => false;
	device.unsetWarning = async () => {};
	device.homey = {
		app: {
			updateLog: (message) => logs.push(message),
			varToString: JSON.stringify,
		},
	};
	await device.getHubDeviceValues();
	assert.equal(logs.length, 1);
	assert.ok(logs[0].includes('meter-1'));
	assert.ok(logs[0].includes('"temperature":20'));
}

run().catch((err) =>
{
	process.stderr.write(`${err.stack || err}\n`);
	process.exitCode = 1;
});
