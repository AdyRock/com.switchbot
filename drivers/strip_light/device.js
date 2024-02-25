/* jslint node: true */

'use strict';

const LightHubDevice = require('../light_hub_device');

class StripLightHubDevice extends LightHubDevice
{

	/**
	 * onOAuth2Init is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();
		this.log('StripLightHubDevice has been initialising');
	}

}

module.exports = StripLightHubDevice;
