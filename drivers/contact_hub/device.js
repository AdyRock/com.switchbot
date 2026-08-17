/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class ContactHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();
		if (!this.hasCapability('direction'))
		{
			this.addCapability('direction').catch(this.error);
		}

		// try
		// {
		// 	await this.getHubDeviceValues();
		// }
		// catch (err)
		// {
		// 	this.setUnavailable(err.message);
		// }

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id, this).catch(this.error);

		this.log('ContactHubDevice has been initialising');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('ContactHubDevice has been added');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('ContactHubDevice was renamed');
	}

	async getHubDeviceValues()
	{
		try
		{
			const data = await this._getHubDeviceValues();
			if (data)
			{
				this.setAvailable();
				this.homey.app.updateLog(`Contact Hub got:${this.homey.app.varToString(data)}`, 3, 'hub');

				this.setCapabilityValue('alarm_motion', data.moveDetected).catch(this.error);
				this.setCapabilityValue('alarm_contact', ((data.openState === 'open') || (data.openState === 'timeOutNotClose'))).catch(this.error);
				this.setCapabilityValue('alarm_contact.left_open', data.openState === 'timeOutNotClose').catch(this.error);

				const bright = (data.brightness === 'bright');
				if (this.getCapabilityValue('bright') !== bright)
				{
					this.setCapabilityValue('bright', bright).catch(this.error);
					this.driver.bright_changed(this, bright);
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
			this.unsetWarning().catch(this.error);
		}
		catch (err)
		{
			this.homey.app.updateLog(`Contact getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0, 'hub');
			this.setWarning(err.message).catch(this.error);
		}
	}

	async pollHubDeviceValues()
	{
		// The webhook is only triggerd for the door contact so we need polling for the motion and bright state
		await this.getHubDeviceValues();
		return true;
	}

	async processWebhookMessage(message)
	{
		try
		{
			const dd = this.getData();
			const context = message && message.context;
			if (context && (dd.id === context.deviceMac))
			{
				// message is for this device
				if (typeof context.detectionState !== 'undefined')
				{
					this.setCapabilityValue('alarm_motion', context.detectionState === 'DETECTED').catch(this.error);
				}

				if (typeof context.openState !== 'undefined')
				{
					this.setCapabilityValue('alarm_contact', context.openState !== 'close').catch(this.error);
					this.setCapabilityValue('alarm_contact.left_open', context.openState === 'timeOutNotClose').catch(this.error);
					if ((context.openState === 'open') && (typeof context.doorMode !== 'undefined'))
					{
						const direction = context.doorMode === 'OUT_DOOR';
						this.setCapabilityValue('direction', direction).catch(this.error);
						this.driver.direction_changed(this, direction);
					}
					else if (context.openState !== 'open')
					{
						this.setCapabilityValue('direction', null).catch(this.error);
					}
				}

				if ((typeof context.battery !== 'undefined') && (context.battery !== null))
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

					this.setCapabilityValue('measure_battery', context.battery).catch(this.error);
				}
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0, 'hub');
		}
	}

}

module.exports = ContactHubDevice;
