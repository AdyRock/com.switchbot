/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class WaterLeakHubDevice extends HubDevice
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

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		this.log('WaterLeakHubDevice has been initialising');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('WaterLeakHubDevice has been added');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('WaterLeakHubDevice was renamed');
	}

	async onSettings({ oldSettings, newSettings, changedKeys })
	{
		if (changedKeys.indexOf('mode') >= 0)
		{
			const mode = this.getCapabilityValue('alarm_water');
			this.setCapabilityValue('alarm_water', !mode).catch(this.error);
		}
	}

	async getHubDeviceValues()
	{
		try
		{
			const data = await this._getHubDeviceValues();
			if (data)
			{
				this.setAvailable();
				this.homey.app.updateLog(`Water Leak Hub got:${this.homey.app.varToString(data)}`, 3);

				const activeState = (this.getSetting('wet') === 'dry' ? 0 : 1);

				this.setCapabilityValue('alarm_water', (data.status === activeState)).catch(this.error);

				if (data.battery)
				{
					this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
				}
			}
			this.unsetWarning().catch(this.error);;
		}
		catch (err)
		{
			this.homey.app.updateLog(`Water Leak getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
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
				const activeState = (this.getSetting('wet') === 'dry' ? 0 : 1);
				this.setCapabilityValue('alarm_water', message.context.detectionState === activeState).catch(this.error);
				if (message.context.battery)
				{
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

module.exports = WaterLeakHubDevice;
