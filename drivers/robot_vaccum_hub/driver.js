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

		// Device Triggers
        this.stateChangedTrigger = this.homey.flow.getDeviceTriggerCard('vaccum_state_changed');

		this.log('HubVacuumDriver has been initialized');
	}

	async onPairListDevices({ oAuth2Client })
	{
		return this.getHUBDevices(oAuth2Client, ['WoSweeper', 'WoSweeperMini']);
	}

    async triggerStateChanged(device, tokens, state)
    {
        this.stateChangedTrigger.trigger(device, tokens, state).catch(this.error);
    }

}

module.exports = HubVacuumDriver;
