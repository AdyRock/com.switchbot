/* jslint node: true */

'use strict';

const LightHubDevice = require('../light_hub_device');

class PermanentOutdoorLights8EHubDevice extends LightHubDevice
{

	/**
	 * onOAuth2Init is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();
		this.log('PermanentOutdoorLights8EHubDevice has been initialising');
	}

}

module.exports = PermanentOutdoorLights8EHubDevice;
