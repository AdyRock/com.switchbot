/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class CameraHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id);

		this.log('CameraHubDevice has been initialising');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('CameraHubDevice has been added');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('CameraHubDevice was renamed');
	}

	async onSettings({ oldSettings, newSettings, changedKeys })
	{
		if (changedKeys.indexOf('duration') >= 0)
		{
			if (this.motionTimer)
			{
				this.homey.clearTimeout(this.motionTimer);
				this.setCapabilityValue('alarm_motion', false).catch(this.error);
			}
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
				this.setCapabilityValue('alarm_motion', message.context.detectionState === 'DETECTED').catch(this.error);
				if (this.motionTimer)
				{
					this.homey.clearTimeout(this.motionTimer);
				}
				this.motionTimer = this.homey.setTimeout(() =>
				{
					this.setCapabilityValue('alarm_motion', false).catch(this.error);
				}, this.getSetting('duration') * 1000);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = CameraHubDevice;
