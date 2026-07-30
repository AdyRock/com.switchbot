/* jslint node: true */

'use strict';

const HubDevice = require('../drivers/hub_device');

class LockAdvancedHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		if (!this.hasCapability('locked'))
		{
			await this.addCapability('locked');
		}

		this.registerCapabilityListener('lock', this.onCapabilityLock.bind(this));
		this.registerCapabilityListener('unlock', this.onCapabilityUnlock.bind(this));

		if (this.supportsDeadbolt())
		{
			this.registerCapabilityListener('deadbolt', this.onCapabilityDeadbolt.bind(this));

			if (!this.hasCapability('deadbolt'))
			{
				await this.addCapability('deadbolt');
			}
		}

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		this.log(`${this.constructor.name} has been initialized`);
	}

	supportsDeadbolt()
	{
		return false;
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log(`${this.constructor.name} has been added`);
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log(`${this.constructor.name} was renamed`);
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

	translateLockStatus(lockState)
	{
		const translatedState = lockState ? this.homey.__(lockState) : null;
		return translatedState || lockState;
	}

	toNormalizedState(lockState)
	{
		return String(lockState || '').toLowerCase();
	}

	isDoorOpen(doorState)
	{
		const value = String(doorState || '').toLowerCase();
		return value === 'open' || value === 'opened';
	}

	async applyLockState(rawState)
	{
		if (rawState === 'locked')
		{
			this.setCapabilityValue('locked', true).catch(this.error);
			this.driver.triggerLocked(this, null, null).catch(this.error);
			return;
		}

		if ((rawState === 'latchboltlocked') || (rawState === 'latched'))
		{
			this.setCapabilityValue('locked', true).catch(this.error);
			this.driver.triggerLatched(this, null, null).catch(this.error);
			return;
		}

		this.setCapabilityValue('locked', false).catch(this.error);
		this.driver.triggerUnlocked(this, null, null).catch(this.error);
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

				const rawState = this.toNormalizedState(data.lockState);
				const lockStatus = this.translateLockStatus(rawState);
				const lastStatus = this.getCapabilityValue('locked_status');

				this.setCapabilityValue('locked_status', lockStatus).catch(this.error);
				this.setCapabilityValue('alarm_generic', rawState === 'jammed').catch(this.error);

				if (data.doorState !== undefined)
				{
					this.setCapabilityValue('alarm_contact', this.isDoorOpen(data.doorState)).catch(this.error);
				}

				if (data.battery !== undefined)
				{
					this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
				}

				if (lastStatus !== lockStatus)
				{
					await this.applyLockState(rawState);
				}
			}

			this.unsetWarning().catch(this.error);
		}
		catch (err)
		{
			this.homey.app.updateLog(`Lock getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
			this.setWarning(err.message).catch(this.error);
		}
	}

	async pollHubDeviceValues()
	{
		await this.getHubDeviceValues();
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
				const rawState = this.toNormalizedState(message.context.lockState);
				const lockStatus = this.translateLockStatus(rawState);
				const lastStatus = this.getCapabilityValue('locked_status');

				this.setCapabilityValue('locked_status', lockStatus).catch(this.error);
				this.setCapabilityValue('alarm_generic', rawState === 'jammed').catch(this.error);

				if (message.context.doorState !== undefined)
				{
					this.setCapabilityValue('alarm_contact', this.isDoorOpen(message.context.doorState)).catch(this.error);
				}

				if (message.context.battery !== undefined)
				{
					this.setCapabilityValue('measure_battery', message.context.battery).catch(this.error);
				}

				if (lastStatus !== lockStatus)
				{
					await this.applyLockState(rawState);
				}
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = LockAdvancedHubDevice;