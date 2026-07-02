/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class WeatherStationHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		this.log('WeatherStationHubDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('WeatherStationHubDevice has been added');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('WeatherStationHubDevice was renamed');
	}

	async getHubDeviceValues()
	{
		try
		{
			const data = await this._getHubDeviceValues();
			if (data)
			{
				this.setAvailable();
				this.homey.app.updateLog(`Weather Station Hub got: ${this.homey.app.varToString(data)}`, 3, 'hub');

				let { temperature } = data;
				if (data.scale && (data.scale !== 'CELSIUS'))
				{
					// Convert F to C
					temperature = ((temperature - 32) * 5) / 9;
				}

				this.setCapabilityValue('measure_temperature', temperature).catch(this.error);
				this.setCapabilityValue('measure_humidity', data.humidity).catch(this.error);

				if (data.battery)
				{
					this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
				}
			}
			this.unsetWarning().catch(this.error);
		}
		catch (err)
		{
			this.homey.app.updateLog(`WeatherStationHubDevice getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0, 'hub');
			this.setWarning(err.message).catch(this.error);
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
				if (message.context.scale && message.context.scale !== 'CELSIUS')
				{
					// Convert F to C
					temperature = ((temperature - 32) * 5) / 9;
				}

				this.setCapabilityValue('measure_temperature', temperature).catch(this.error);
				this.setCapabilityValue('measure_humidity', message.context.humidity).catch(this.error);

				if (message.context.battery)
				{
					this.setCapabilityValue('measure_battery', message.context.battery).catch(this.error);
				}
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0, 'hub');
		}
	}

	async onCapabilityCustomQuote(customText)
	{
		return this._operateDevice('customQuote', customText);
	}

	async onCapabilityCancelCustom()
	{
		return this._operateDevice('cancelCustom', 'default');
	}

	async onCapabilityCustomPage(customText)
	{
		return this._operateDevice('customPage', customText);
	}

}

module.exports = WeatherStationHubDevice;
