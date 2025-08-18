/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class S10WaterStationDriver extends HubDriver
{

	/**
	 * onOAuth2Init is called when the driver is initialized.
	 */
	async onOAuth2Init()
	{
		super.onOAuth2Init();

		this.log('HubVacuumDriver has been initialized');
	}

	async onPairListDevices({ oAuth2Client })
	{
		return this.getHUBDevices(oAuth2Client, ['Robot Vacuum Cleaner S10', 'K10+ Pro', 'Robot Vacuum Cleaner S20']);
	}

}

module.exports = S10WaterStationDriver;
