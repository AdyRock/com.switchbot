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

// eslint-disable-next-line no-console
console.log('Temporary diagnostics tests passed');
