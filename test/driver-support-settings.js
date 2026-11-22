'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../settings/index.html'), 'utf8');
const start = html.indexOf('\t\tvar driverSupportRequestId = 0;');
const end = html.indexOf('\t\tfunction hasTextValue(', start);
assert.ok(start >= 0 && end > start);

const requests = [];
const rendered = [];
const cursor = [];
const modeBLEElement = { checked: false };
const context = {
	modeBLEElement,
	Homey: {
		api: (method, endpoint, body, callback) => requests.push({ mode: body.mode, callback }),
	},
	renderDriverSupportError: (message) => rendered.push(message),
	renderDriverSupport: (result) => rendered.push(result),
	translateSetting: (key, fallback) => fallback,
	waitCursor: (enabled) => cursor.push(enabled),
};
vm.runInNewContext(html.slice(start, end), context);

context.refreshDriverSupport();
modeBLEElement.checked = true;
context.refreshDriverSupport();
assert.equal(requests[0].mode, 'hub');
assert.equal(requests[1].mode, 'ble');
requests[1].callback(null, 'BLE result');
requests[0].callback(null, 'outdated Hub result');
assert.equal(rendered[rendered.length - 1], 'BLE result');
assert.equal(cursor.filter((enabled) => enabled === false).length, 1);

modeBLEElement.checked = false;
context.refreshDriverSupport();
requests[2].callback(null, 'Hub result');
assert.equal(rendered[rendered.length - 1], 'Hub result');

// eslint-disable-next-line no-console
console.log('Driver support settings tests passed');
