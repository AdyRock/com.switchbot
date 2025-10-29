/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class RadiatorThermostatHubDriver extends HubDriver
{

	/**
	 * onOAuth2Init is called when the driver is initialized.
	 */
	async onOAuth2Init()
	{
		super.onOAuth2Init();
		this.log('RadiatorThermostatHubDriver has been initialized');
	}

	/**
	 * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
	 * This should return an array with the data of devices that are available for pairing.
	 */
	async onPairListDevices({ oAuth2Client })
	{
		return this.getHUBDevices(oAuth2Client, ['Smart Radiator Thermostat'], false, true);
	}

}

module.exports = RadiatorThermostatHubDriver;
