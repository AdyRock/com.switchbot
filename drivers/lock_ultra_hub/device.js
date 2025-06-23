/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class LockUltraHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		this.registerCapabilityListener('lock', this.onCapabilityLock.bind(this));
		this.registerCapabilityListener('unlock', this.onCapabilityUnlock.bind(this));
		this.registerCapabilityListener('deadbolt', this.onCapabilityDeadbolt.bind(this));

		if (!this.hasCapability('deadbolt'))
		{
			this.addCapability('deadbolt');
		}

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		this.log('LockUltraHubDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('LockUltraHubDevice has been added');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('LockUltraHubDevice was renamed');
	}

	async onSettings({ oldSettings, newSettings, changedKeys })
	{
		// Called when settings changed
	}

	// this method is called when the Homey device has requested to lock
	async onCapabilityLock(value, opts)
	{
		return this._operateBot('lock');
	}

	// this method is called when the Homey device has requested to unlock
	async onCapabilityUnlock(value, opts)
	{
		return this._operateBot('unlock');
	}

	// this method is called when the Homey device has requested to deadbolt
	async onCapabilityDeadbolt(value, opts)
	{
		return this._operateBot('deadbolt');
	}

	async _operateBot(command)
	{
		const data = {
			command,
			parameter: 'default',
			commandType: 'command',
		};

		return super.setDeviceData(data).catch(this.error);
	}

	async getHubDeviceValues()
	{
		try
		{
			const data = await this._getHubDeviceValues();
			if (data)
			{
				this.setAvailable();
				this.homey.app.updateLog(`Lock Hub got: ${this.homey.app.varToString(data)}`, 3);

				// Make the lockStatus lowercase and then look up the translation
				let lockStatus = this.homey.__(data.lockState.toLowerCase());

				// If the translation is not found, use the original value
				if (!lockStatus)
				{
					lockStatus = data.lockState;
				}

				this.setCapabilityValue('locked_status', lockStatus).catch(this.error);
				this.setCapabilityValue('alarm_generic', lockStatus === 'jammed').catch(this.error);
				this.setCapabilityValue('alarm_contact', (data.doorState === 'open') || (data.doorState === 'opened')).catch(this.error);

				if (data.battery)
				{
					this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
				}

				if (lockStatus === 'locked')
				{
					this.driver.triggerLocked(this, { locked: true }, null).catch(this.error);
				}
				else
				{
					this.driver.triggerUnlocked(this, { unlocked: true }, null).catch(this.error);
				}
			}
			this.unsetWarning().catch(this.error);
		}
		catch (err)
		{
			this.homey.app.updateLog(`Lock getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
			this.setWarning(err.message);
		}
	}

	async pollHubDeviceValues()
	{
		this.getHubDeviceValues();
		return true;
	}

	async processWebhookMessage(message)
	{
		try
		{
			const dd = this.getData();
			if (dd.id === message.context.deviceMac)
			{
				// message is for this device
				// Make the lockStatus lowercase and then look up the translation
				let lockStatus = this.homey.__(message.context.lockState.toLowerCase());

				// If the translation is not found, use the original value
				if (!lockStatus)
				{
					lockStatus = data.lockStatus;
				}

				this.setCapabilityValue('locked_status', lockStatus).catch(this.error);
				this.setCapabilityValue('alarm_generic', lockStatus === 'JAMMED').catch(this.error);

				if (message.context.battery)
				{
					this.setCapabilityValue('measure_battery', message.context.battery).catch(this.error);
				}

				if (lockStatus === 'LOCKED')
				{
					this.driver.triggerLocked(this, { locked: true }, null).catch(this.error);
				}
				else
				{
					this.driver.triggerUnlocked(this, { unlocked: true }, null).catch(this.error);
				}
				}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = LockUltraHubDevice;
