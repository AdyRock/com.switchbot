/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class Presence2HubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		if (!this.hasCapability('measure_luminance'))
		{
			try
			{
				await this.addCapability('measure_luminance');
			}
			catch (err)
			{
				this.log(err);
			}
		}

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		this.log('Presence2HubDevice has been initialising');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('Presence2HubDevice has been added');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('Presence2HubDevice was renamed');
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
				this.homey.app.updateLog(`Presence Hub got: ${this.homey.app.varToString(data)}`, 3);

				this.setCapabilityValue('alarm_presence', data.detected).catch(this.error);

				if (data.lightLevel)
				{
					this.setCapabilityValue('measure_luminance', data.lightLevel * 5).catch(this.error);
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
			this.unsetWarning().catch(this.error);;
		}
		catch (err)
		{
			this.homey.app.updateLog(`Presence getHubDeviceValues: ${this.homey.app.varToString(err.message)}`);
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
				this.setCapabilityValue('alarm_presence', message.context.detectionState === 'DETECTED').catch(this.error);

				if (this.hasCapability('measure_luminance') && message.context.lightLevel)
				{
					this.setCapabilityValue('measure_luminance', message.context.lightLevel * 5).catch(this.error);
				}

				if (message.context.battery)
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

module.exports = Presence2HubDevice;
