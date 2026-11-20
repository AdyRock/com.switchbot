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
	],
	infraredRemoteList: [],
});

app.getDriverSupportMatrix().then((result) =>
{
	assert.equal(result.totalSwitchBotDevices, 3);
	assert.equal(result.totalUnsupported, 0);
	assert.equal(result.recommendations.length, 0);
	assert.ok(result.notSupportableDevices.some((device) => device.deviceType === 'Outdoor Spotlight Cam'));
	assert.ok(result.notSupportableDevices.some((device) => device.deviceType === 'Wallet Finder Card'));
	// eslint-disable-next-line no-console
	console.log('Driver support matrix tests passed');
}).catch((err) =>
{
	// eslint-disable-next-line no-console
	console.error(err);
	process.exitCode = 1;
});
