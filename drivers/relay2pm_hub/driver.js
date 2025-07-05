/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class Relay2pmDriver extends HubDriver
{

	/**
	 * onOAuth2Init is called when the driver is initialized.
	 */
	async onOAuth2Init()
	{
		super.onOAuth2Init();
		this.relay1OnTrigger = this.homey.flow.getDeviceTriggerCard('onoff_relay1_true');
		this.relay1OffTrigger = this.homey.flow.getDeviceTriggerCard('onoff_relay1_false');
		this.relay2OnTrigger = this.homey.flow.getDeviceTriggerCard('onoff_relay2_true');
		this.relay2OffTrigger = this.homey.flow.getDeviceTriggerCard('onoff_relay2_false');

		this.log('Relay2pmDriver has been initialized');
	}

	/**
	 * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
	 * This should return an array with the data of devices that are available for pairing.
	 */
	async onPairListDevices({ oAuth2Client })
	{
		return this.getHUBDevices(oAuth2Client, 'Relay Switch 2PM');
	}

	async triggerRelay1_On(device, tokens, state)
	{
		this.relay1OnTrigger.trigger(device, tokens, state).catch(this.error);
	}

	async triggerRelay1_Off(device, tokens, state)
	{
		this.relay1OffTrigger.trigger(device, tokens, state).catch(this.error);
	}

	async triggerRelay2_On(device, tokens, state)
	{
		this.relay2OnTrigger.trigger(device, tokens, state).catch(this.error);
	}

	async triggerRelay2_Off(device, tokens, state)
	{
		this.relay2OffTrigger.trigger(device, tokens, state).catch(this.error);
	}
}

module.exports = Relay2pmDriver;
