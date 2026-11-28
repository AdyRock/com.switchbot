'use strict';

// Run with: node test/driver-support-matrix.js
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const appModule = { exports: {} };
const Homey = { env: {} };
function OAuth2App() {}
function DependencyStub() {}

vm.runInNewContext(source, {
	module: appModule,
	exports: appModule.exports,
	process,
	console,
	setTimeout,
	clearTimeout,
	Buffer,
	__dirname: path.join(__dirname, '..'),
	require: (name) =>
	{
		if (name === 'homey') return Homey;
		if (name === 'homey-oauth2app') return { OAuth2App };
		if (name === 'nodemailer') return {};
		if (name === './lib/hub_interface' || name === './lib/ble_hub_interface' || name === './lib/SwitchBotOAuth2Client') return DependencyStub;
		if (name === 'fs') return fs;
		if (name === 'path') return path;
		if (name === 'tls') return tls;
		throw new Error(`Unexpected dependency: ${name}`);
	},
});

const MyApp = appModule.exports;
const app = Object.create(MyApp.prototype);
app.openToken = 'token';
app.openSecret = 'secret';
app.homey = {
	drivers: {
		getDrivers: () => ({}),
	},
};
app.updateLog = () => {};
app.getFirstSavedOAuth2Client = () => null;
app.getHUBDevices = async () => ({
	deviceList: [
		{ deviceId: 'camera-one', deviceName: 'Outdoor Cam', deviceType: 'Outdoor Spotlight Cam' },
		{ deviceId: 'camera-two', deviceName: 'Outdoor Spotlight Cam', deviceType: 'Outdoor Spotlight Cam' },
		{ deviceId: 'wallet', deviceName: 'Wallet Finder', deviceType: 'Wallet Finder Card' },
		{ deviceId: 'B0E9FE531977', deviceName: 'Universal Remote', deviceType: 'remote with screen' },
	],
	infraredRemoteList: [],
});

async function run()
{
	const result = await app.getDriverSupportMatrix();
	assert.equal(result.totalSwitchBotDevices, 4);
	assert.equal(result.totalUnsupported, 0);
	assert.equal(result.recommendations.length, 0);
	assert.ok(result.notSupportableDevices.some((device) => device.deviceType === 'Outdoor Spotlight Cam'));
	assert.ok(result.notSupportableDevices.some((device) => device.deviceType === 'Wallet Finder Card'));
	assert.ok(result.notSupportableDevices.some((device) => device.deviceType === 'remote with screen'));

	const paired = (id) => ({ getData: () => ({ id }) });
	const driver = (id, name, devices) => ({
		id,
		manifest: { name: { en: name } },
		getDevices: () => devices,
	});
	app.homey.drivers.getDrivers = () => ({
		temperature_hub: driver('temperature_hub', 'Temperature & Humidity (HUB)', [paired('112233445566')]),
		temperature_ble: driver('temperature_ble', 'Temperature & Humidity (BLE)', [paired('aabbccddeeff')]),
		water_leak_hub: driver('water_leak_hub', 'Water Leak Detector (HUB)', [paired('998877665544')]),
		water_leak_ble: driver('water_leak_ble', 'Water Leak Sensor (BLE)', [paired('998877665544')]),
	});
	app.getHUBDevices = async () => ({
		deviceList: [
			{ deviceId: 'AABBCCDDEEFF', deviceName: 'Office', deviceType: 'Meter' },
			{ deviceId: '112233445566', deviceName: 'Kitchen', deviceType: 'Meter' },
			{ deviceId: '998877665544', deviceName: 'Leak', deviceType: 'Water Detector' },
			{ deviceId: '123456789012', deviceName: 'Unknown', deviceType: 'Unknown' },
		],
		infraredRemoteList: [],
	});
	const hub = await app.getDriverSupportMatrix('hub');
	assert.equal(hub.totalMatchedDrivers, 2);
	assert.equal(hub.totalSupportedInstalled, 2);
	assert.equal(hub.totalSupportedNotInstalled, 1);
	assert.equal(hub.totalUnsupported, 1);
	assert.ok(hub.recommendations.every((item) => !item.recommendedDriverId.endsWith('_ble')));
	const office = hub.recommendations.find((item) => item.deviceId === 'AABBCCDDEEFF');
	assert.equal(office.recommendedDriverId, 'temperature_hub');
	assert.equal(office.isInstalled, false);
	const kitchen = hub.recommendations.find((item) => item.deviceId === '112233445566');
	assert.equal(kitchen.recommendedDriverId, 'temperature_hub');
	assert.equal(kitchen.isInstalled, true);
	const leak = hub.recommendations.filter((item) => item.deviceId === '998877665544');
	assert.equal(leak.length, 1);
	assert.equal(leak[0].recommendedDriverId, 'water_leak_hub');
	assert.equal(leak[0].isInstalled, true);

	app.getDetectedBLEDevices = async () => [{
		modelName: 'Meter',
		model: 'T',
		address: 'aa:bb:cc:dd:ee:ff',
		matchedDriverId: 'temperature_ble',
		matchedDriverName: 'Temperature & Humidity (BLE)',
		isInstalled: true,
	}];
	const ble = await app.getDriverSupportMatrix('ble');
	assert.equal(ble.totalSupportedInstalled, 1);
	assert.equal(ble.recommendations[0].recommendedDriverId, 'temperature_ble');

	app.homey.drivers.getDrivers = () => ({
		art_frame_hub: driver('art_frame_hub', 'Art Frame (HUB)', []),
	});
	app.getHUBDevices = async () => ({
		deviceList: [
			{ deviceId: 'B0E9FE93BD77', deviceName: 'AI Art Frame 2 77', deviceType: 'AI Art Frame 2' },
		],
		infraredRemoteList: [],
	});
	const artFrame = await app.getDriverSupportMatrix('hub');
	assert.equal(artFrame.totalUnsupported, 0);
	assert.equal(artFrame.recommendations[0].recommendedDriverId, 'art_frame_hub');
	// eslint-disable-next-line no-console
	console.log('Driver support matrix tests passed');
}

run().catch((err) =>
{
	// eslint-disable-next-line no-console
	console.error(err);
	process.exitCode = 1;
});
