/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class GarageDoorOpenerDriver extends HubDriver
{

	/**
	 * onOAuth2Init is called when the driver is initialized.
	 */
	async onOAuth2Init()
	{
		super.onOAuth2Init();
		this.openTrigger = this.homey.flow.getDeviceTriggerCard('open_close_true');
		this.closeTrigger = this.homey.flow.getDeviceTriggerCard('open_close_false');

		this.log('GarageDoorOpenerDriver has been initialized');
	}

	/**
	 * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
	 * This should return an array with the data of devices that are available for pairing.
	 */
	async onPairListDevices({ oAuth2Client })
	{
		return this.getHUBDevices(oAuth2Client, ['Garage Door Opener']);
	}

	async onOpenClosedChangeTrigger(device, openCloseState)
	{
		if (openCloseState)
		{
			this.openTrigger.trigger(device).catch(this.error);
		}
		else
		{
			this.closeTrigger.trigger(device).catch(this.error);
		}
	}
}

module.exports = GarageDoorOpenerDriver;
