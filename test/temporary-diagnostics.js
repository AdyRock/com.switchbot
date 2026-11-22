'use strict';

// Run with: node test/temporary-diagnostics.js
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
app.updateLog = () => {};

const now = Date.now();
assert.equal(app.enableTemporaryDiagnostics(), true);
assert.ok(app.temporaryDiagnosticsUntil >= now + (5 * 60 * 1000));
assert.ok(app.temporaryDiagnosticsUntil <= Date.now() + (5 * 60 * 1000) + 100);
assert.ok(app.temporaryDiagnosticsNextAllowedAt >= now + (15 * 60 * 1000));
assert.throws(() => app.enableTemporaryDiagnostics(), /Temporary diagnostics can be enabled again in \d+ seconds/);

app.temporaryDiagnosticsUntil = Date.now() - 1;
assert.equal(app.isTemporaryDiagnosticsActive(), false);

const loggingApp = Object.create(MyApp.prototype);
const logLines = [];
const errorLines = [];
loggingApp.homey = {
	settings: {
		get: (key) =>
		{
			if (key === 'logLevel') return 0;
			if (key === 'logSource') return 'ble';
			return null;
		},
	},
};
loggingApp.originalLog = (line) => logLines.push(line);
loggingApp.originalError = (line) => errorLines.push(line);
loggingApp.diagLog = '';
loggingApp.temporaryDiagnosticsUntil = Date.now() + 60000;
loggingApp.updateLog('temporary BLE log', 2, 'ble');
loggingApp.updateLog('temporary Hub log', 2, 'hub');
loggingApp.updateLog('temporary webhook log one', 1, 'hub');
loggingApp.updateLog('temporary webhook log two', 1, 'hub');
assert.equal(logLines.length, 0);
assert.equal(errorLines.length, 4);
loggingApp.temporaryDiagnosticsUntil = 0;
loggingApp.updateLog('not logged after expiry', 2, 'hub');
loggingApp.updateLog('webhook not logged after expiry', 1, 'hub');
assert.equal(errorLines.length, 4);

const filterApp = Object.create(MyApp.prototype);
let selectedFilterValue = 'temperature_hub';
const filterDevice = {
	getData: () => ({ id: 'meter-1', type: 'Meter' }),
	getName: () => 'Meter in kitchen',
};
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'));
const temperatureManifest = manifest.drivers.find((driver) => driver.id === 'temperature_hub');
filterApp.homey = {
	manifest,
	drivers: {
		getDrivers: () => ({
			temperature_hub: {
				manifest: temperatureManifest,
				getDevices: () => ({ meter: filterDevice }),
			},
		}),
	},
	i18n: { getLanguage: () => 'en' },
	settings: {
		get: (key) => (key === 'logFilterType' ? 'deviceType' : selectedFilterValue),
	},
};
const filterOptions = filterApp.getLogFilterOptions();
const filterTemperature = filterOptions.deviceType.filter((option) => option.value === 'temperature_hub');
assert.equal(filterTemperature.length, 1);
assert.equal(filterTemperature[0].label, 'Temperature & Humidity (HUB) [temperature_hub]');
assert.equal(filterTemperature[0].legacyTypes[0], 'Meter');
assert.ok(filterOptions.bySource.hub.deviceType.some((option) => option.value === 'temperature_hub'));
assert.ok(!filterOptions.bySource.ble.deviceType.some((option) => option.value === 'temperature_hub'));
assert.equal(filterOptions.identifier.length, 1);
assert.equal(filterApp.matchesLogDeviceFilter('Meter in kitchen temperature_hub'), true);
selectedFilterValue = 'Meter';
assert.equal(filterApp.matchesLogDeviceFilter('Meter in kitchen temperature_hub'), true);
assert.equal(filterApp.matchesLogDeviceFilter('Unrelated device'), false);

const extraOptions = filterApp.buildLogFilterOptions([
	{ driverId: 'temperature_hub', driverName: 'Temperature', deviceType: 'Meter', logSource: 'hub' },
	{ driverId: 'temperature_hub', driverName: 'Temperature', deviceType: 'MeterPlus', logSource: 'hub' },
	{ driverId: 'other_hub', driverName: 'Other', deviceType: 'Meter', logSource: 'hub' },
	{ driverId: '', driverName: '', deviceType: 'Unknown', logSource: 'hub' },
]);
assert.equal(extraOptions.deviceType.length, 3);
const temperatureOption = extraOptions.deviceType.find((option) => option.value === 'temperature_hub');
assert.equal(temperatureOption.legacyTypes.length, 2);
assert.ok(temperatureOption.legacyTypes.includes('MeterPlus'));
assert.ok(extraOptions.deviceType.some((option) => option.value === 'other_hub'));
assert.ok(extraOptions.deviceType.some((option) => option.value === 'Unknown'));

filterApp.homey.drivers.getDrivers = () => ({});
const unpairedOptions = filterApp.getLogFilterOptions();
assert.equal(unpairedOptions.deviceType.length, manifest.drivers.length);
assert.equal(unpairedOptions.identifier.length, 0);
for (const driver of manifest.drivers)
{
	assert.equal(unpairedOptions.deviceType.filter((option) => option.value === driver.id).length, 1);
	for (const [connectivity, source] of [['ble', 'ble'], ['cloud', 'hub']])
	{
		const count = unpairedOptions.bySource[source].deviceType.filter((option) => option.value === driver.id).length;
		assert.equal(count, driver.connectivity.includes(connectivity) ? 1 : 0, driver.id);
	}
}

// eslint-disable-next-line no-console
console.log('Temporary diagnostics tests passed');
