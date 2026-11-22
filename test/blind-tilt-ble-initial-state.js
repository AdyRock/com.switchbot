'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../drivers/blind_tilt_ble/device.js'), 'utf8');
const deviceModule = { exports: {} };
vm.runInNewContext(source, {
	Buffer,
	module: deviceModule,
	setImmediate,
	require: (name) =>
	{
		if (name === 'homey') return { Device: class {} };
		throw new Error(`Unexpected dependency: ${name}`);
	},
});
const BlindTiltBLEDevice = deviceModule.exports;

async function run()
{
	const device = new BlindTiltBLEDevice();
	const forceValues = [];
	device.log = () => {};
	device.getDeviceValues = async (forceUpdate) =>
	{
		forceValues.push(forceUpdate);
	};

	await device.onAdded();
	assert.deepEqual(forceValues, [true]);
}

run().catch((err) =>
{
	process.stderr.write(`${err.stack || err}\n`);
	process.exitCode = 1;
});
