/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class ArtFrameHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		const dd = this.getData();
		this.registerCapabilityListener('speaker_next', this.onCapabilityNext.bind(this));
		this.registerCapabilityListener('speaker_prev', this.onCapabilityPrev.bind(this));

		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		this.log('ArtFrameHubDevice has been initialising');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('ArtFrameHubDevice has been added');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('ArtFrameHubDevice was renamed');
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

	onCapabilityNext(value, opts)
	{
		const result = this.sendCommand('next', '');

		// after 5 seconds call the getHubDeviceValues method to fetch the latest values from the hub device
		this.homey.setTimeout(() =>
		{
			this.getHubDeviceValues().catch(this.error);
		}
		, 5000);
		return result;
	}

	onCapabilityPrev(value, opts)
	{
		const result = this.sendCommand('previous', '');

		// after 5 seconds call the getHubDeviceValues method to fetch the latest values from the hub device
		this.homey.setTimeout(() =>
		{
			this.getHubDeviceValues().catch(this.error);
		}
		, 30000);
		return result;
	}

	async sendCommand(command, parameter)
	{
		const data = {
			command,
			parameter,
			commandType: 'command',
		};

		return super.setDeviceData(data);
	}

	async getHubDeviceValues()
	{
		// get the current values for the device and update the capabilities
		try
		{
			const values = await this._getHubDeviceValues();
			if (values)
			{
				this.setCapabilityValue('measure_battery', values.battery).catch(this.error);

				this.nowImage = await this.homey.images.createImage();
				this.nowImage.setUrl(values.imageUrl);
				await this.nowImage.update();

				this.setAlbumArtImage(this.nowImage).catch(this.error);
			}
		}
		catch (err)
		{
			this.setUnavailable(err.message);
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
				this.setCapabilityValue('measure_battery', message.context.battery).catch(this.error);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = ArtFrameHubDevice;
