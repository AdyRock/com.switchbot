/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class RadiatorThermostatHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		this.registerCapabilityListener('target_temperature', this.onCapabilityTargetTemperature.bind(this));
		this.registerCapabilityListener('radiator_thermostat_mode', this.onCapabilityRadiatorThermostatMode.bind(this));

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		this.log('RadiatorThermostatHubDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('RadiatorThermostatHubDevice has been added');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('RadiatorThermostatHubDevice was renamed');
	}

	async onCapabilityTargetTemperature(value)
	{
		this.log(`RadiatorThermostatHubDevice onCapabilityTargetTemperature: ${value}`);
		return this._operateDevice('setManualModeTemperature', value);
	}

	async onCapabilityRadiatorThermostatMode(value)
	{
		const valueNum = parseInt(value, 10);
		this.log(`RadiatorThermostatHubDevice onCapabilityRadiatorThermostatMode: ${valueNum}`);
		return this._operateDevice('setMode', valueNum);
	}

	async getHubDeviceValues()
	{
		try
		{
			const data = await this._getHubDeviceValues();
			if (data)
			{
				this.setAvailable();
				this.homey.app.updateLog(`Thermostat Hub got: ${this.homey.app.varToString(data)}`, 3);

				this.setCapabilityValue('measure_temperature', data.temperature).catch(this.error);

				if (data.battery)
				{
					this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
				}
			}
			this.unsetWarning().catch(this.error);;
		}
		catch (err)
		{
			this.homey.app.updateLog(`Thermostat getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
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
				if (message.context.temperature)
				{
					let { temperature } = message.context;
					if (message.context.scale && message.context.scale !== 'CELSIUS')
					{
						// Convert F to C
						temperature = ((temperature - 32) * 5) / 9;
					}

					this.setCapabilityValue('measure_temperature', temperature).catch(this.error);
				}

				if (message.context.battery)
				{
					if (!this.hasCapability('measure_battery'))
					{
						try
						{
							await this.addCapability('measure_battery');
						}
						catch(err)
						{
							this.log(err);
						}
					}

					this.setCapabilityValue('measure_battery', message.context.battery).catch(this.error);
				}
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`Thermostat processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = RadiatorThermostatHubDevice;
