/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class HubVacuumS10Driver extends HubDriver
{

	/**
	 * onOAuth2Init is called when the driver is initialized.
	 */
	async onOAuth2Init()
	{
		super.onOAuth2Init();

		this.log('HubVacuumS10Driver has been initialized');
	}

	async onPairListDevices({ oAuth2Client })
	{
		return this.getHUBDevices(oAuth2Client, ['Robot Vacuum Cleaner S10', 'Robot Vacuum Cleaner S20']);
	}

	async triggerStateChanged(device, tokens, state)
	{
		this.homey.app.stateChangedTrigger.trigger(device, tokens, state).catch(this.error);
	}

	async triggerStateChangedTo(device, tokens, state)
	{
		this.homey.app.stateChangedToTrigger.trigger(device, tokens, state).catch(this.error);
	}

	async triggerTaskChanged(device, tokens, state)
	{
		this.homey.app.taskChangedTrigger.trigger(device, tokens, state).catch(this.error);
	}

	async triggerTaskChangedTo(device, tokens, state)
	{
		this.homey.app.taskChangedToTrigger.trigger(device, tokens, state).catch(this.error);
	}

}

module.exports = HubVacuumS10Driver;
