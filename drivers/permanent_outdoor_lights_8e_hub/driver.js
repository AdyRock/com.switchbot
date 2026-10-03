/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class PermanentOutdoorLights8EDriver extends HubDriver

{

	/**

	 * onOAuth2Init is called when the driver is initialized.

	 */

	async onOAuth2Init()

	{

		super.onOAuth2Init();

		this.log('PermanentOutdoorLights8EDriver has been initialized');

	}

	/**

	 * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.

	 */

	async onPairListDevices({ oAuth2Client })

	{

		return this.getHUBDevices(oAuth2Client, ['Permanent Outdoor Lights']);

	}

}

module.exports = PermanentOutdoorLights8EDriver;
