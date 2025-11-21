/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class HubVacuumDriver extends HubDriver
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
		return this.getHUBDevices(oAuth2Client, ['WoSweeper', 'WoSweeperMini', 'K10+', 'K10+ Pro']);
	}

	async triggerStateChanged(device, tokens, state)
	{
		this.homey.app.stateChangedTrigger.trigger(device, tokens, state).catch(this.error);
	}

	async triggerStateChangedTo(device, tokens, state)
	{
		this.homey.app.stateChangedToTrigger.trigger(device, tokens, state).catch(this.error);
	}

}

module.exports = HubVacuumDriver;
