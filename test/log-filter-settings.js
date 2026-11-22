'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../settings/index.html'), 'utf8');
const start = html.indexOf('\t\tfunction populateLogFilterValues(');
const end = html.indexOf('\t\tfunction updateLogSettingsSummary()', start);
assert.ok(start >= 0 && end > start);
const populateSource = html.slice(start, end);

class Element
{
	constructor(tag)
	{
		this.tag = tag;
		this.children = [];
		this.dataset = {};
		this.value = '';
		this.classes = new Set();
		this.classList = {
			add: (name) => this.classes.add(name),
			toggle: (name, enabled) => (enabled ? this.classes.add(name) : this.classes.delete(name)),
		};
	}

	set innerHTML(value)
	{
		assert.equal(value, '');
		this.children = [];
		this.value = '';
	}

	appendChild(child)
	{
		this.children.push(child);
		if (this.tag === 'select' && this.children.length === 1) this.value = child.value;
	}

	setAttribute(name, value)
	{
		this[name] = value;
	}

	addEventListener(name, callback)
	{
		this[name] = callback;
	}

	querySelectorAll()
	{
		return this.children;
	}
}

function render(options, selectedValue)
{
	const select = new Element('select');
	const list = new Element('div');
	const context = {
		document: { createElement: (tag) => new Element(tag) },
		logFilterTypeElement: { value: 'deviceType' },
		logSourceElement: { value: 'hub' },
		logFilterOptions: { bySource: { hub: { deviceType: options } } },
		logFilterValueElement: select,
		logFilterValueListElement: list,
		updateLogFilterIdentifierLabel: () => {},
		createDriverSupportIcon: () => new Element('img'),
		selectedValue,
	};
	vm.runInNewContext(`${populateSource}\npopulateLogFilterValues(selectedValue);`, context);
	return { select, list };
}

const temperature = {
	value: 'temperature_hub',
	label: 'Temperature & Humidity (HUB)',
	driverId: 'temperature_hub',
	legacyTypes: ['Meter', 'MeterPlus'],
};
const other = {
	value: 'other_hub',
	label: 'Other (HUB)',
	driverId: 'other_hub',
	legacyTypes: ['Shared'],
};

const savedLegacy = render([temperature, other], 'Meter');
assert.equal(savedLegacy.list.children.length, 2);
assert.equal(savedLegacy.select.value, 'Meter');
assert.equal(savedLegacy.select.children.filter((option) => option.hidden).length, 1);
assert.ok(savedLegacy.list.children[0].classes.has('selected'));
savedLegacy.list.children[0].click();
assert.equal(savedLegacy.select.value, 'temperature_hub');

const savedDriver = render([temperature, other], 'temperature_hub');
assert.equal(savedDriver.select.value, 'temperature_hub');
assert.equal(savedDriver.select.children.length, 2);
assert.ok(savedDriver.list.children[0].classes.has('selected'));

const sharedLegacy = render([
	{ ...temperature, legacyTypes: ['Shared'] },
	other,
], 'Shared');
assert.equal(sharedLegacy.select.value, 'Shared');
assert.equal(sharedLegacy.list.children.length, 2);
assert.ok(sharedLegacy.list.children.every((item) => !item.classes.has('selected')));

// eslint-disable-next-line no-console
console.log('Log filter settings tests passed');
