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

		// Device Triggers
		this.stateChangedTrigger = this.homey.flow.getDeviceTriggerCard('vaccum_state_changed');
		this.stateChangedToTrigger = this.homey.flow.getDeviceTriggerCard('vaccum_state_changed_to');
		this.stateChangedToTrigger.registerRunListener(async (args, state) =>
		{
			if (args.state === state.state)
			{
				return true;
			}
			return false;
		});

		this.taskChangedTrigger = this.homey.flow.getDeviceTriggerCard('vaccum_task_changed');
		this.taskChangedToTrigger = this.homey.flow.getDeviceTriggerCard('vaccum_task_changed_to');
		this.taskChangedToTrigger.registerRunListener(async (args, state) =>
		{
			if (args.state === state.state)
			{
				return true;
			}
			return false;
		});

		this.log('HubVacuumK20Driver has been initialized');
	}

	async onPairListDevices({ oAuth2Client })
	{
		return this.getHUBDevices(oAuth2Client, ['Robot Vacuum Cleaner K20 Plus Pro', 'K10+ Pro Combo']);
	}

	async triggerStateChanged(device, tokens, state)
	{
		this.stateChangedTrigger.trigger(device, tokens, state).catch(this.error);
	}

	async triggerStateChangedTo(device, tokens, state)
	{
		this.stateChangedToTrigger.trigger(device, tokens, state).catch(this.error);
	}

	async triggerTaskChanged(device, tokens, state)
	{
		this.taskChangedTrigger.trigger(device, tokens, state).catch(this.error);
	}

	async triggerTaskChangedTo(device, tokens, state)
	{
		this.taskChangedToTrigger.trigger(device, tokens, state).catch(this.error);
	}

}

module.exports = HubVacuumK20Driver;
