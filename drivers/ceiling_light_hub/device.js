/* jslint node: true */

'use strict';

const LightHubDevice = require('../light_hub_device');

class CeilingLightHubDevice extends LightHubDevice
{

	/**
	 * onOAuth2Init is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		this.log('CeilingLightHubDevice has been initialising');
	}

}

module.exports = CeilingLightHubDevice;
