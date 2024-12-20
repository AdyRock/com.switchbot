/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class S10WaterStationHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		try
		{
			await this.getHubDeviceValues();
		}
		catch (err)
		{
			this.setUnavailable(err.message);
		}

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id);

		this.log('S10WaterStationHubDevice has been initialising');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('S10WaterStationHubDevice has been added');
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
		this.log('S10WaterStationHubDevice was renamed');
	}

	async getHubDeviceValues()
	{
		try
		{
			const data = await this._getHubDeviceValues();
			if (data)
			{
				this.setAvailable();
				this.homey.app.updateLog(`S10WaterStationHubDevice: ${this.homey.app.varToString(data)}`, 3);

				if (data.waterBaseBattery)
				{
					if (!this.hasCapability('measure_battery'))
					{
						await this.addCapability('measure_battery');
					}

					this.setCapabilityValue('measure_battery', data.waterBaseBattery).catch(this.error);
				}

				this.unsetWarning();
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`S10WaterStationHubDevice getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
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
				if (data.waterBaseBattery)
				{
					if (!this.hasCapability('measure_battery'))
					{
						await this.addCapability('measure_battery');
					}

					this.setCapabilityValue('measure_battery', data.waterBaseBattery).catch(this.error);
				}
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = S10WaterStationHubDevice;
