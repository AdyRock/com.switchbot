/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class VacuumHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		// try
		// {
		// 	await this.getHubDeviceValues();
		// }
		// catch (err)
		// {
		// 	this.setUnavailable(err.message);
		// }

		this.registerCapabilityListener('play', this.onCapabilityCommand.bind(this, 'start'));
		this.registerCapabilityListener('stop', this.onCapabilityCommand.bind(this, 'stop'));
		this.registerCapabilityListener('robot_vaccum_dock', this.onCapabilityCommand.bind(this, 'dock'));
		this.registerCapabilityListener('vaccum_power_level.quiet', this.onCapabilityPowerLevel.bind(this, 0));
		this.registerCapabilityListener('vaccum_power_level.normal', this.onCapabilityPowerLevel.bind(this, 1));
		this.registerCapabilityListener('vaccum_power_level.strong', this.onCapabilityPowerLevel.bind(this, 2));
		this.registerCapabilityListener('vaccum_power_level.max', this.onCapabilityPowerLevel.bind(this, 3));

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id);

		this.log('VacuumHubDevice has been initialising');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('VacuumHubDevice has been added');
	}

	/**
	 * onSettings is called when the user updates the device's settings.
	 * @param {object} event the onSettings event data
	 * @param {object} event.oldSettings The old settings object
	 * @param {object} event.newSettings The new settings object
	 * @param {string[]} event.changedKeys An array of keys changed since the previous version
	 * @returns {Promise<string|void>} return a custom message that will be displayed
	 */
	async onSettings({ oldSettings, newSettings, changedKeys })
	{
		// No settings yet
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('VacuumHubDevice was renamed');
	}

	async onCapabilityPowerLevel(level, value, opts)
	{
		this._operateDevice('PowLevel', level);
	}

	async pollHubDeviceValues()
	{
		this.getHubDeviceValues();
		return true;
	}

	async getHubDeviceValues()
	{
		try
		{
			const data = await this._getHubDeviceValues();
			if (data)
			{
				this.setAvailable();
				this.homey.app.updateLog(`Vacuum Hub got: ${this.homey.app.varToString(data)}`, 3);

				if (data.workingStatus && data.workingStatus !== this.getCapabilityValue('robot_vaccum_state'))
				{
					this.setCapabilityValue('robot_vaccum_state', data.workingStatus).catch(this.error);

					const tokens = {
						state: data.workingStatus,
					};

					this.driver.triggerStateChanged(this, tokens, null).catch(this.error);

					const args = {
						state: data.workingStatus,
					};
					this.driver.triggerStateChangedTo(this, null, args).catch(this.error);
				}

				if (data.battery)
				{
					if (!this.hasCapability('measure_battery'))
					{
						await this.addCapability('measure_battery');
					}

					this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
				}

				this.unsetWarning();
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`BlindTilt getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
			this.setWarning(err.message);
		}
	}

	async processWebhookMessage(message)
	{
		try
		{
			const dd = this.getData();
			if (dd.id === message.context.deviceMac)
			{
				// message is for this device
				const data = message.context;
				this.homey.app.updateLog(`Vacuum Hub got: ${this.homey.app.varToString(data)}`, 3);

				if (data.workingStatus && data.workingStatus !== this.getCapabilityValue('robot_vaccum_state'))
				{
					this.setCapabilityValue('robot_vaccum_state', data.workingStatus).catch(this.error);

					const tokens = {
						state: data.workingStatus,
					};

					this.driver.triggerStateChanged(this, tokens, null).catch(this.error);

					const args = {
						state: data.workingStatus,
					};
					this.driver.triggerStateChangedTo(this, null, args).catch(this.error);
				}

				if (data.battery)
				{
					if (!this.hasCapability('measure_battery'))
					{
						await this.addCapability('measure_battery');
					}

					this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
				}
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = VacuumHubDevice;
