'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../drivers/blind_tilt_hub/device.js'), 'utf8');
const deviceModule = { exports: {} };
vm.runInNewContext(source, {
	module: deviceModule,
	require: (name) =>
	{
			if (name === '../hub_device')
			{
				return class {
					async onAdded()
					{
						await this.onOAuth2Added();
					}
				};
			}
		throw new Error(`Unexpected dependency: ${name}`);
	},
});
const BlindTiltHubDevice = deviceModule.exports;

async function run()
{
	const webhookDevice = new BlindTiltHubDevice();
	let webhookFetches = 0;
	webhookDevice.getData = () => ({ id: 'blind-1', type: 'Blind Tilt' });
	webhookDevice.getHubDeviceValues = async () =>
	{
		webhookFetches++;
		return true;
	};

	assert.equal(await webhookDevice.pollHubDeviceValues(), true);
	assert.equal(await webhookDevice.pollHubDeviceValues(), false);
	assert.equal(webhookFetches, 1);

	const newlyAdded = new BlindTiltHubDevice();
	let addedFetches = 0;
	newlyAdded.getHubDeviceValues = async () =>
	{
		addedFetches++;
		return true;
	};
	newlyAdded.log = () => {};
	await newlyAdded.onAdded();
	assert.equal(addedFetches, 1);
	assert.equal(newlyAdded.initialHubValuesFetched, true);

	const legacyDevice = new BlindTiltHubDevice();
	let legacyFetches = 0;
	legacyDevice.getData = () => ({ id: 'blind-2' });
	legacyDevice.getHubDeviceValues = async () =>
	{
		legacyFetches++;
		return true;
	};

	assert.equal(await legacyDevice.pollHubDeviceValues(), true);
	assert.equal(await legacyDevice.pollHubDeviceValues(), true);
	assert.equal(legacyFetches, 2);

	const retryingDevice = new BlindTiltHubDevice();
	let retryFetches = 0;
	retryingDevice.getData = () => ({ id: 'blind-3', type: 'Blind Tilt' });
	retryingDevice.getHubDeviceValues = async () =>
	{
		retryFetches++;
		return retryFetches > 1;
	};

	assert.equal(await retryingDevice.pollHubDeviceValues(), true);
	assert.equal(retryingDevice.initialHubValuesFetched, undefined);
	assert.equal(await retryingDevice.pollHubDeviceValues(), true);
	assert.equal(retryingDevice.initialHubValuesFetched, true);
	assert.equal(await retryingDevice.pollHubDeviceValues(), false);
}

run().catch((err) =>
{
	process.stderr.write(`${err.stack || err}\n`);
	process.exitCode = 1;
});
