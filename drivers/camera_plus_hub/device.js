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
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		this.video = null;
		this.registerVideoStream();

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
		if ((changedKeys.indexOf('ip') >= 0) || (changedKeys.indexOf('username') >= 0) || (changedKeys.indexOf('password') >= 0))
		{
			this.registerVideoStream();
		}
	}

	async registerVideoStream()
	{
		if (this.video)
		{
			this.homey.videos.unregisterVideo(this.video);
			this.video = null;
		}

		const settings = this.getSettings();

		if (settings.username && settings.password && settings.ip)
		{
			this.homey.app.updateLog('Registering Now video stream (' + this.name + ')');
			this.video = await this.homey.videos.createVideoRTSP();
			this.video.registerVideoUrlListener(async () =>
			{
				const url = `RTSP://${settings.username}:${settings.password}@${settings.ip}:554/live0`;
				this.homey.app.updateLog(`Setting Live video stream to ${url}`);
				return { url };
			});
			this.setCameraVideo('live_video', 'Live Video', this.video).catch(this.err);
			this.homey.app.updateLog('registered Now video stream (' + this.name + ')');
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
