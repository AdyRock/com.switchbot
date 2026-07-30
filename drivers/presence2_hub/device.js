/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class Presence2HubDevice extends HubDevice
{

	parsePresenceState(value)
	{
		if (typeof value === 'boolean')
		{
			return value;
		}

		if (typeof value === 'number')
		{
			return value !== 0;
		}

		if (typeof value === 'string')
		{
			const text = value.trim().toUpperCase();
			if (['DETECTED', 'OCCUPIED', 'PRESENT', 'TRUE', '1', 'MOTION'].includes(text))
			{
				return true;
			}

			if (['NOT_DETECTED', 'UNOCCUPIED', 'ABSENT', 'FALSE', '0', 'CLEAR', 'NONE'].includes(text))
			{
				return false;
			}
		}

		return null;
	}

	resolvePresenceState(data)
	{
		if (!data || typeof data !== 'object')
		{
			return null;
		}

		const candidateFields = ['detected', 'presence', 'moveDetected', 'motionDetected', 'detectionState', 'occupancy', 'occupancyState'];
		for (const field of candidateFields)
		{
			if (typeof data[field] !== 'undefined')
			{
				const parsed = this.parsePresenceState(data[field]);
				if (parsed !== null)
				{
					return parsed;
				}
			}
		}

		return null;
	}

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
				this.homey.app.updateLog(this.homey.app.varToString(err), 'hub');
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
		await this.getHubDeviceValues();
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
				this.homey.app.updateLog(`Presence Hub got: ${this.homey.app.varToString(data)}`, 3, 'hub');

				const presenceDetected = this.resolvePresenceState(data);
				if (presenceDetected !== null)
				{
					this.setCapabilityValue('alarm_presence', presenceDetected).catch(this.error);
				}
				else
				{
					this.homey.app.updateLog(`Presence state not found in payload, defaulting to false: ${this.homey.app.varToString(data)}`, 1, 'hub');
					this.setCapabilityValue('alarm_presence', false).catch(this.error);
				}

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
							this.homey.app.updateLog(this.homey.app.varToString(err), 'hub');
						}
					}

					this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
				}
			}
			this.unsetWarning().catch(this.error);;
		}
		catch (err)
		{
			this.homey.app.updateLog(`Presence getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 'hub');
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
				const presenceDetected = this.resolvePresenceState(message.context);
				this.setCapabilityValue('alarm_presence', presenceDetected === null ? false : presenceDetected).catch(this.error);

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
							this.homey.app.updateLog(this.homey.app.varToString(err), 'hub');
						}

					}

					this.setCapabilityValue('measure_battery', message.context.battery).catch(this.error);
				}
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0, 'hub');
		}
	}

}

module.exports = Presence2HubDevice;
