/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class Hub3Device extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		const dd = this.getData();
		this.setCapabilityOptions('measure_luminance', { title: this.homey.__('capabilities.brightness'), units: '%' }).catch(this.error);

		this.homey.app.registerHomeyWebhook(dd.id);

		this.log('Hub3Device has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('Hub3Device has been added');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('Hub3Device was renamed');
	}

	async getHubDeviceValues()
	{
		try
		{
			const data = await this._getHubDeviceValues();
			if (data)
			{
				this.setAvailable();
				this.homey.app.updateLog(`Hub3Device got: ${this.homey.app.varToString(data)}`, 3);

				this.setCapabilityValue('measure_temperature', data.temperature).catch(this.error);
				this.setCapabilityValue('measure_humidity', data.humidity).catch(this.error);

				this.setCapabilityValue('measure_luminance', data.lightLevel * 5).catch(this.error);
				this.setCapabilityValue('alarm_motion', data.detectionState === 'DETECTED').catch(this.error);
			}
			this.unsetWarning();
		}
		catch (err)
		{
			this.homey.app.updateLog(`Hub3Device getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
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
				if (message.context.scale && message.context.scale !== 'CELSIUS')
				{
					// Convert F to C
					temperature = ((temperature - 32) * 5) / 9;
				}

				this.setCapabilityValue('measure_temperature', temperature).catch(this.error);
				this.setCapabilityValue('measure_humidity', message.context.humidity).catch(this.error);

				this.setCapabilityValue('measure_luminance', message.context.lightLevel * 5).catch(this.error);
				this.setCapabilityValue('alarm_motion', message.context.detectionState === 'DETECTED').catch(this.error);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = Hub3Device;
