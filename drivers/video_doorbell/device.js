/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class VideoDoorBellDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		if (!this.hasCapability('motion_enabled'))
		{
			await this.addCapability('motion_enabled').catch(this.error);
			this.setCapabilityValue('motion_enabled', true).catch(this.error);
			this.enableMotion(true).catch(this.error);
		}
		this.registerCapabilityListener('motion_enabled', this.enableMotion.bind(this));


		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		this.video = null;
		this.registerVideoStream();

		this.log('VideoDoorBellDevice has been initialising');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('VideoDoorBellDevice has been added');
		this.setCapabilityValue('motion_enabled', true).catch(this.error);
		this.enableMotion(true).catch(this.error);
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('VideoDoorBellDevice was renamed');
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

	async enableMotion(value, opts)
	{
		const command = value ? 'enableMotionDetection' : 'disableMotionDetection';
		return this._operateDevice(command);
	}

	async registerVideoStream()
	{
		if (this.video)
		{
			this.homey.videos.unregisterVideo(this.video);
			this.video = null;
		}

		if ((typeof this.homey.hasFeature === 'function') && this.homey.hasFeature('camera-streaming'))
		{
			const settings = this.getSettings();
			const data = this.getData();

			if (settings.username && settings.password && settings.ip)
			{
				this.homey.app.updateLog('Registering Now video stream (' + this.name + ')');
				this.video = await this.homey.videos.createVideoRTSP();
				this.video.registerVideoUrlListener(async () =>
				{
					const url = `rtsp://${settings.username}:${settings.password}@${settings.ip}:554/${data.id}/live1`;
					this.homey.app.updateLog(`Setting Live video stream to ${url}`);
					return { url };
				});
				this.setCameraVideo('live_video', 'Live Video', this.video).catch(this.err);
				this.homey.app.updateLog('registered Now video stream (' + this.name + ')');
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
				if (message.context.detectionState)
				{
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

				if (message.context.press)
				{
					this.setCapabilityValue('alarm_generic', message.context.press).catch(this.error);
					if (this.doorbellTimer)
					{
						this.homey.clearTimeout(this.doorbellTimer);
					}
					this.doorbellTimer = this.homey.setTimeout(() =>
					{
						this.setCapabilityValue('alarm_generic', false).catch(this.error);
					}, this.getSetting('duration') * 1000);
				}

				this.setCapabilityValue('measure_battery', message.context.battery).catch(this.error);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = VideoDoorBellDevice;
