/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class VacuumK11HubDevice extends HubDevice
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

		this.registerCapabilityListener('play', this.onCapabilityPlay.bind(this));
		this.registerCapabilityListener('pause', this.onCapabilityCommand.bind(this, 'pause'));
		this.registerCapabilityListener('volume_set', this.onCapabilitySetVolume.bind(this));
		this.registerCapabilityListener('vaccum_fan_level', this.onCapabilityFanLevel.bind(this));
		this.registerCapabilityListener('vaccum_water_level', this.onCapabilityWaterLevel.bind(this));
		this.registerCapabilityListener('vaccum_times', this.onCapabilityTimes.bind(this));
		this.registerCapabilityListener('vaccum_clean_mode', this.onCapabilityCleanMode.bind(this));

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		this.log('VacuumK11HubDevice has been initialising');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('VacuumK11HubDevice has been added');
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
		this.log('VacuumK11HubDevice was renamed');
	}

	async onCapabilityPlay(value, opts)
	{
		let fanLevel = this.getCapabilityValue('vaccum_fan_level');
		if (!fanLevel)
		{
			fanLevel = '1';
		}

		let times = this.getCapabilityValue('vaccum_times');
		if (!times)
		{
			times = '1';
		}

		let action = this.getCapabilityValue('robot_vaccum_clean_mode');
		if (!action)
		{
			action = 'sweep';
		}

		this.startVacuum(action, fanLevel, times).catch(this.error);
	}

	async startVacuum(action, fanLevel, times)
	{
		const parameter = { action, param: { fanLevel: parseInt(fanLevel, 10), times: parseInt(times, 10) } };

		const data = {
			command: 'startClean',
			parameter,
			commandType: 'command',
		};

		return this.setDeviceData(data);
	}

	async onCapabilityFanLevel(value, opts)
	{
		return this._operateDevice('changeParam', { fanLevel: parseInt(value, 10) }).catch(this.error);
	}

	async onCapabilityWaterLevel(value, opts)
	{
		return this._operateDevice('changeParam', { waterLevel: parseInt(value, 10) }).catch(this.error);
	}

	async onCapabilityTimes(value, opts)
	{
		return this._operateDevice('changeParam', { times: parseInt(value, 10) }).catch(this.error);
	}

	async onCapabilitySetVolume(value, opts)
	{
		return this._operateDevice('setVolume', parseInt(value * 100, 10)).catch(this.error);
	}

	async onCapabilityCleanMode(value, opts)
	{
		// Nothing to do as it is just used for the start command
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
				this.homey.app.updateLog(`VacuumK11HubDevicegot: ${this.homey.app.varToString(data)}`, 3);

				// Check for working status
				if (data.workingStatus)
				{
					// Make the workingStatus lowercase and then look up the translation
					let workingStatus = this.homey.__(data.workingStatus.toLowerCase());

					// If the translation is not found, use the original value
					if (!workingStatus)
					{
						workingStatus = data.workingStatus;
					}

					if (workingStatus !== this.getCapabilityValue('robot_vaccum_state'))
					{
						this.setCapabilityValue('robot_vaccum_state', workingStatus).catch(this.error);

						const tokens = {
							state: data.workingStatus,
						};

						this.driver.triggerStateChanged(this, tokens, null).catch(this.error);

						const args = {
							state: data.workingStatus,
						};
						this.driver.triggerStateChangedTo(this, null, args).catch(this.error);
					}
				}

				// Check for task
				if (data.taskType)
				{
					// Make the taskType lowercase and then look up the translation
					let taskType = this.homey.__(data.taskType.toLowerCase());

					// If the translation is not found, use the original value
					if (!taskType)
					{
						taskType = data.taskType;
					}

					if (taskType !== this.getCapabilityValue('robot_vaccum_task'))
					{
						this.setCapabilityValue('robot_vaccum_task', taskType).catch(this.error);

						const tokens = {
							task: data.taskType,
						};

						this.driver.triggerTaskChanged(this, tokens, null).catch(this.error);

						const args = {
							task: data.taskType,
						};
						this.driver.triggerTaskChangedTo(this, null, args).catch(this.error);
					}
				}

				// Check for battery
				if (data.battery)
				{
					if (!this.hasCapability('measure_battery'))
					{
						try
						{
							await this.addCapability('measure_battery');
						}
						catch (err)
						{
							this.log(err);
						}

					}

					this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
				}

				this.unsetWarning().catch(this.error);;
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`VacuumK11HubDevice getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
			this.setWarning(err.message).catch(this.error);;
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
				if (data)
				{
					// Check for working status
					if (data.workingStatus)
					{
						// Make the workingStatus lowercase and then look up the translation
						let workingStatus = this.homey.__(data.workingStatus.toLowerCase());

						// If the translation is not found, use the original value
						if (!workingStatus)
						{
							workingStatus = data.workingStatus;
						}

						if (workingStatus !== this.getCapabilityValue('robot_vaccum_state'))
						{
							this.setCapabilityValue('robot_vaccum_state', workingStatus).catch(this.error);

							const tokens = {
								state: data.workingStatus,
							};

							this.driver.triggerStateChanged(this, tokens, null).catch(this.error);

							const args = {
								state: data.workingStatus,
							};
							this.driver.triggerStateChangedTo(this, null, args).catch(this.error);
						}
					}

					// Check for task
					if (data.taskType)
					{
						// Make the taskType lowercase and then look up the translation
						let taskType = this.homey.__(data.taskType.toLowerCase());

						// If the translation is not found, use the original value
						if (!taskType)
						{
							taskType = data.taskType;
						}

						if (taskType !== this.getCapabilityValue('robot_vaccum_task'))
						{
							this.setCapabilityValue('robot_vaccum_task', taskType).catch(this.error);

							const tokens = {
								task: data.taskType,
							};

							this.driver.triggerTaskChanged(this, tokens, null).catch(this.error);

							const args = {
								task: data.taskType,
							};
							this.driver.triggerTaskChangedTo(this, null, args).catch(this.error);
						}
					}

					if (data.battery)
					{
						if (!this.hasCapability('measure_battery'))
						{
							try
							{
								await this.addCapability('measure_battery');
							}
							catch (err)
							{
								this.log(err);
							}
						}

						this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
					}
				}
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = VacuumK11HubDevice;
