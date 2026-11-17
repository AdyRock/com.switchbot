'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../drivers/robot_vacuum_K11_hub/driver.js'), 'utf8');
const driverModule = { exports: {} };
vm.runInNewContext(source, {
	module: driverModule,
	require: (name) =>
	{
		if (name === '../hub_driver') return class {};
		throw new Error(`Unexpected dependency: ${name}`);
	},
});
const HubVacuumK11Driver = driverModule.exports;
const driver = new HubVacuumK11Driver();
let pairingTypes;
driver.getHUBDevices = async (oAuth2Client, types, remote) =>
{
	pairingTypes = types;
	return [];
};

driver.onPairListDevices({ oAuth2Client: null }).then(() =>
{
	assert.equal(JSON.stringify(pairingTypes), JSON.stringify(['Robot Vacuum Cleaner K11 Plus', 'Robot Vacuum Cleaner K11 Plus Pro']));
}).catch((err) =>
{
	console.error(err);
	process.exitCode = 1;
});
