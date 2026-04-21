/* jslint node: true */

'use strict';

const LightHubDevice = require('../light_hub_device');

class CandleWarmerLampHubDevice extends LightHubDevice
{

	/**
	 * onOAuth2Init is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		this.log('CandleWarmerLampHubDevice has been initialising');
	}

}

module.exports = CandleWarmerLampHubDevice;
