/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class LightRemoteHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		this.registerCapabilityListener('power_on', this.onCapabilityCommand.bind(this, 'turnOn'));
		this.registerCapabilityListener('power_off', this.onCapabilityCommand.bind(this, 'turnOff'));
		this.registerCapabilityListener('brightness_up', this.onCapabilityCommand.bind(this, 'brightnessUp'));
		this.registerCapabilityListener('brightness_down', this.onCapabilityCommand.bind(this, 'brightnessDown'));

		this.log('LightRemoteHubDevice has been initialized');
	}

}

module.exports = LightRemoteHubDevice;
