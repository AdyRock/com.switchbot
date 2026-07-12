/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class RGBICWWCeilingLightDriver extends HubDriver
{

	/**
	 * onOAuth2Init is called when the driver is initialized.
	 */
	async onOAuth2Init()
	{
		super.onOAuth2Init();
		this.colorOnTrigger = this.homey.flow.getDeviceTriggerCard('onoff_colour_true');
		this.colorOffTrigger = this.homey.flow.getDeviceTriggerCard('onoff_colour_false');
		this.colorDimChangedTrigger = this.homey.flow.getDeviceTriggerCard('dim_colour_changed');
		this.log('RGBICWWCeilingLightDriver has been initialized');
	}

	/**
	 * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
	 * This should return an array with the data of devices that are available for pairing.
	 */
	async onPairListDevices({ oAuth2Client })
	{
		return this.getHUBDevices(oAuth2Client, ['RGBICWW Ceiling Light'], false, false);
	}

	triggerColorOn(device, tokens, state)
	{
		this.colorOnTrigger.trigger(device, tokens, state).catch(this.error);
	}

	triggerColorOff(device, tokens, state)
	{
		this.colorOffTrigger.trigger(device, tokens, state).catch(this.error);
	}

	triggerColorDimChanged(device, tokens, state)
	{
		this.colorDimChangedTrigger.trigger(device, tokens, state).catch(this.error);
	}

}

module.exports = RGBICWWCeilingLightDriver;
