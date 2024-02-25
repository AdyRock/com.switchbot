/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class TemperatureHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		const dd = this.getData();
		if (dd.type === 'Hub 2')
		{
			if (!this.hasCapability('measure_luminance'))
			{
				this.addCapability('measure_luminance').catch(this.error);
			}

			this.setCapabilityOptions('measure_luminance', { title: this.homey.__('capabilities.brightness'), units: '%' }).catch(this.error);
		}
		else if (this.hasCapability('measure_luminance'))
		{
			this.removeCapability('measure_luminance').catch(this.error);
		}

		try
		{
			await this.getHubDeviceValues();
		}
		catch (err)
		{
			this.setUnavailable(err.message);
		}

		this.homey.app.registerHomeyWebhook(dd.id);

		this.log('TemperatureHubDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('TemperatureHubDevice has been added');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('TemperatureHubDevice was renamed');
	}

	async getHubDeviceValues()
	{
		try
		{
			const data = await this._getHubDeviceValues();
			if (data)
			{
				this.setAvailable();
				this.homey.app.updateLog(`Temperature Hub got: ${this.homey.app.varToString(data)}`, 3);

				this.setCapabilityValue('measure_temperature', data.temperature).catch(this.error);
				this.setCapabilityValue('measure_humidity', data.humidity).catch(this.error);

				if (this.hasCapability('measure_luminance'))
				{
					this.setCapabilityValue('measure_luminance', data.lightLevel * 5).catch(this.error);
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
			this.unsetWarning();
		}
		catch (err)
		{
			this.homey.app.updateLog(`Temperature getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
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
				let { temperature } = message.context;
				if (message.context.scale !== 'CELSIUS')
				{
					// Convert F to C
					temperature = ((temperature - 32) * 5) / 9;
				}

				this.setCapabilityValue('measure_temperature', temperature).catch(this.error);
				this.setCapabilityValue('measure_humidity', message.context.humidity).catch(this.error);

				if (this.hasCapability('measure_luminance'))
				{
					this.setCapabilityValue('measure_luminance', message.context.lightLevel * 5).catch(this.error);
				}

				if (message.context.battery)
				{
					if (!this.hasCapability('measure_battery'))
					{
						await this.addCapability('measure_battery');
					}

					this.setCapabilityValue('measure_battery', message.context.battery).catch(this.error);
				}
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = TemperatureHubDevice;
