/* jslint node: true */

'use strict';

const LightHubDevice = require('../light_hub_device');

class ColorBulbHubDevice extends LightHubDevice
{

	/**
	 * onOAuth2Init is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		this.log('ColorBulbHubDevice has been initialising');
	}

}

module.exports = ColorBulbHubDevice;
