/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class HubPresence2Driver extends HubDriver
{

	/**
	 * onOAuth2Init is called when the driver is initialized.
	 */
	async onOAuth2Init()
	{
		super.onOAuth2Init();
		this.log('HubPresence2Driver has been initialized');

		// Device Triggers
		this.bright_changed_trigger = this.homey.flow.getDeviceTriggerCard('bright_changed');
	}

	bright_changed(device, bright)
	{
		const tokens = {
			bright,
		};

		this.bright_changed_trigger.trigger(device, tokens)
			.catch(this.error);
	}

	async onPairListDevices({ oAuth2Client })
	{
		return this.getHUBDevices(oAuth2Client, 'Presence Sensor', false, true);
	}

}

module.exports = HubPresence2Driver;
