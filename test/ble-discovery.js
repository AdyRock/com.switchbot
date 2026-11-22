'use strict';

// Run with: node test/ble-discovery.js
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const vm = require('vm');

class HomeyBase {}

function load(file, dependencies)
{
	const loaded = { exports: {} };
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
		module: loaded,
		process: { env: {} },
		Buffer,
		require: (name) =>
		{
			if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name];
			if (name === 'fs') return fs;
			if (name === 'path') return path;
			if (name === 'tls') return tls;
			throw new Error(`Unexpected dependency: ${name}`);
		},
	});
	return loaded.exports;
}

const App = load('../app.js', {
	homey: {},
	'homey-oauth2app': { OAuth2App: HomeyBase },
	nodemailer: {},
	'./lib/hub_interface': {},
	'./lib/ble_hub_interface': {},
	'./lib/SwitchBotOAuth2Client': {},
});
const BLEDriver = load('../drivers/ble_driver.js', { homey: { Driver: HomeyBase } });

function fixture()
{
	const app = new App();
	const calls = { scans: [], timers: [], logs: [] };
	const parser = new BLEDriver();
	parser.parse = (advertisement) => ({
		address: advertisement.address,
		serviceData: { model: '?', modelName: 'Plug Mini (EU)' },
	});
	app.homey = {
		app,
		ble: { discover: async (services, duration) =>
		{
			calls.scans.push({ services, duration });
			return [];
		} },
		drivers: { getDrivers: () => ({ plug_eu_ble: parser }) },
		api: { realtime: async () => {} },
		setTimeout: (callback, delay) =>
		{
			calls.timers.push({ callback, delay });
			return calls.timers.length;
		},
	};
	parser.homey = app.homey;
	app.bleRegisteredDevices = new Set();
	app.bleDeviceCache = new Map();
	app.initialBLEDiscoveryDone = false;
	app.initialBLEDiscoveryAttempts = 0;
	app.initialBLEDiscoveryPromise = new Promise((resolve) => { app.initialBLEDiscoveryResolve = resolve; });
	app.updateLog = (message) => calls.logs.push(message);
	app.varToString = JSON.stringify;
	app.Delay = async () => {};
	return { app, parser, calls };
}

async function run()
{
	const idle = fixture();
	idle.app.startBLEDiscoveryCache();
	for (let tick = 0; tick < 5; tick++)
	{
		await idle.app.onBLEDiscoveryCacheTick();
	}
	await idle.app.whenInitialBLEDiscoveryComplete();
	assert.equal(idle.calls.scans.length, 0, 'cloud-only startup and recurring ticks must not scan');
	assert.equal(idle.app.initialBLEDiscoveryAttempts, 0, 'skipping discovery must not trigger startup retries');

	const paired = fixture();
	paired.app.bleRegisteredDevices.add('paired-device');
	await paired.app.onBLEDiscoveryCacheTick();
	await paired.app.whenInitialBLEDiscoveryComplete();
	assert.equal(paired.calls.scans.length, 1, 'paired BLE devices must retain background scanning');
	assert.equal(paired.calls.scans[0].duration, 6000);
	assert.equal(paired.calls.timers[0].delay, 60000);
	paired.app.bleRegisteredDevices.clear();
	await paired.app.onBLEDiscoveryCacheTick();
	assert.equal(paired.calls.scans.length, 1, 'removing the last BLE device must stop automatic scans');
	paired.app.bleRegisteredDevices.add('new-device');
	await paired.app.onBLEDiscoveryCacheTick();
	assert.equal(paired.calls.scans.length, 2, 'automatic scanning must resume after adding a BLE device');

	const retry = fixture();
	retry.app.bleRegisteredDevices.add('paired-device');
	retry.app.homey.drivers.getDrivers = () => ({});
	await retry.app.onBLEDiscoveryCacheTick();
	assert.equal(retry.app.initialBLEDiscoveryDone, false);
	assert.equal(retry.calls.timers[0].delay, 3000, 'paired startup must still retry until drivers are ready');
	retry.app.bleRegisteredDevices.clear();
	await retry.app.onBLEDiscoveryCacheTick();
	await retry.app.whenInitialBLEDiscoveryComplete();
	assert.equal(retry.app.initialBLEDiscoveryDone, true);

	const pairing = fixture();
	await pairing.app.onBLEDiscoveryCacheTick();
	pairing.app.homey.ble.discover = async () =>
	{
		assert.ok(!pairing.app.bleDiscovery, 'pairing must refresh before claiming the discovery lock');
		pairing.calls.scans.push({});
		return [{ address: 'aa:bb:cc:dd:ee:ff', rssi: -50 }];
	};
	pairing.app.buildDetectedBLEDeviceRowsFromCache = () => [];
	const devices = await pairing.parser.getBLEDevices('?');
	assert.equal(pairing.calls.scans.length, 1, 'first BLE pairing must scan without existing BLE devices');
	assert.equal(devices.length, 1);
	assert.equal(devices[0].data.address, 'aa:bb:cc:dd:ee:ff');
	await pairing.app.onBLEDiscoveryCacheTick();
	assert.equal(pairing.calls.scans.length, 1, 'pairing discovery alone must not enable background scans');

	const manual = fixture();
	await manual.app.onBLEDiscoveryCacheTick();
	let manualScan = false;
	manual.app.runDetectedBLEDevicesScan = async () => { manualScan = true; return []; };
	await manual.app.getDetectedBLEDevices();
	assert.equal(manualScan, true, 'Scan Now must remain available without paired BLE devices');
	assert.equal(manual.app.bleBusy, false);

	const failed = fixture();
	await failed.app.onBLEDiscoveryCacheTick();
	failed.app.homey.ble.discover = async () => { throw new Error('radio failed'); };
	await assert.rejects(() => failed.parser.getBLEDevices('?'), /radio failed/);
	assert.equal(failed.app.bleBusy, false, 'failed pairing discovery must release the radio');

	const curtain3 = fixture();
	await curtain3.app.onBLEDiscoveryCacheTick();
	curtain3.app.homey.i18n = { getLanguage: () => 'en' };
	curtain3.parser.id = 'curtains_ble';
	curtain3.parser.manifest = { name: { en: 'Curtains (BLE)' } };
	curtain3.app.homey.drivers.getDrivers = () => ({ curtains_ble: curtain3.parser });
	curtain3.app.BLEHub = {
		getBLEHubDevices: async () => [{
			address: 'c5:bd:1d:ab:c0:e1',
			serviceData: { model: '{', modelName: 'WoCurtain3' },
		}],
	};
	const recommendations = new Map();
	curtain3.app.addDetectedBLEDevice(
		recommendations,
		curtain3.app.homey.drivers.getDrivers(),
		'c5:bd:1d:ab:c0:e1',
		{ model: '{', modelName: 'WoCurtain3' },
		-54,
		true,
	);
	assert.equal(recommendations.get('c5:bd:1d:ab:c0:e1').matchedDriverId, 'curtains_ble');
	const curtain3Devices = await curtain3.parser.getBLEDevices('c');
	assert.equal(curtain3Devices.length, 1, 'Curtain 3 BLE-hub model alias must be pairable by the curtain driver');
	assert.equal(curtain3Devices[0].data.modelName, 'WoCurtain3');

	const rawParser = new BLEDriver();
	rawParser.homey = curtain3.app.homey;
	const parsedCurtain3 = rawParser.parse({
		address: 'db:27:4e:46:3c:c5',
		uuid: 'db274e463cc5',
		id: 'db274e463cc5',
		rssi: -71,
		serviceData: [{ uuid: '0000fd3d-0000-1000-8000-00805f9b34fb', data: Buffer.from([0x7b, 0, 50, 25, 2]) }],
	});
	assert.equal(parsedCurtain3.serviceData.model, 'c');
	assert.equal(parsedCurtain3.serviceData.modelName, 'WoCurtain3');

	process.stdout.write('PASS BLE discovery gating, startup, device changes, pairing, Scan Now, and scan failure\n');
}

run().catch((err) =>
{
	process.stderr.write(`${err.stack || err}\n`);
	process.exitCode = 1;
});
