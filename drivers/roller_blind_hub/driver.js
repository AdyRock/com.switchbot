/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class HubRollerBlindDriver extends HubDriver
{

	/**
	 * onOAuth2Init is called when the driver is initialized.
	 */
	async onOAuth2Init()
	{
		super.onOAuth2Init();
		this.log('HubRollerBlindDriver has been initialized');
	}

	async onPairListDevices({ oAuth2Client })
	{
		return this.getHUBDevices(oAuth2Client, 'WoRollerShade', false, true);
	}

}

module.exports = HubRollerBlindDriver;
