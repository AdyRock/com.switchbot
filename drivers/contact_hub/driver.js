/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class HubContactDriver extends HubDriver
{

	/**
	 * onOAuth2Init is called when the driver is initialized.
	 */
	async onOAuth2Init()
	{
		super.onOAuth2Init();

		// Device Triggers
		this.bright_changed_trigger = this.homey.flow.getDeviceTriggerCard('bright_changed');
		this.direction_changed_trigger = this.homey.flow.getDeviceTriggerCard('direction_changed');

		this.log('HubContactDriver has been initialized');
	}

	bright_changed(device, bright)
	{
		const tokens = {
			bright,
		};

		this.bright_changed_trigger.trigger(device, tokens)
			.catch(this.error);
	}

	direction_changed(device, direction)
	{
		const tokens = {
			direction,
		};

		this.direction_changed_trigger.trigger(device, tokens)
			.catch(this.error);
	}

	async onPairListDevices({ oAuth2Client })
	{
		return this.getHUBDevices(oAuth2Client, 'Contact Sensor', false, true);
	}

}

module.exports = HubContactDriver;
