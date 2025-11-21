/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class HubVacuumK20Driver extends HubDriver
{

	/**
	 * onOAuth2Init is called when the driver is initialized.
	 */
	async onOAuth2Init()
	{
		super.onOAuth2Init();

		this.log('HubVacuumK20Driver has been initialized');
	}

	async onPairListDevices({ oAuth2Client })
	{
		return this.getHUBDevices(oAuth2Client, ['Robot Vacuum Cleaner K20 Plus Pro', 'K10+ Pro Combo']);
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

module.exports = HubVacuumK20Driver;
