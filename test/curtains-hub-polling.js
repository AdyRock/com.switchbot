'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../drivers/curtains_hub/device.js'), 'utf8');
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
const CurtainsHubDevice = deviceModule.exports;

async function run()
{
	const added = new CurtainsHubDevice();
	let fetches = 0;
	added.log = () => {};
	added.getData = () => ({ id: 'curtain-1', type: 'Curtain' });
	added.getHubDeviceValues = async () =>
	{
		fetches++;
		return true;
	};

	await added.onAdded();
	assert.equal(fetches, 1);
	assert.equal(added.initialHubValuesFetched, true);
	assert.equal(await added.pollHubDeviceValues(), false);

	const retrying = new CurtainsHubDevice();
	let retries = 0;
	retrying.getData = () => ({ id: 'curtain-2', type: 'Curtain' });
	retrying.getHubDeviceValues = async () =>
	{
		retries++;
		return retries > 1;
	};

	assert.equal(await retrying.pollHubDeviceValues(), true);
	assert.equal(retrying.initialHubValuesFetched, undefined);
	assert.equal(await retrying.pollHubDeviceValues(), true);
	assert.equal(retrying.initialHubValuesFetched, true);
	assert.equal(await retrying.pollHubDeviceValues(), false);
}

run().catch((err) =>
{
	process.stderr.write(`${err.stack || err}\n`);
	process.exitCode = 1;
});
