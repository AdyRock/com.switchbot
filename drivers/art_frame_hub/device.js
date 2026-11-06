/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

const URL_IMAGE_CAPABILITIES = ['url_image_index', 'url_image_next', 'url_image_prev', 'url_image_random'];

class ArtFrameHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		// Make sure devices that were paired with an older version get the new capabilities
		for (const capability of URL_IMAGE_CAPABILITIES)
		{
			if (!this.hasCapability(capability))
			{
				try
				{
					await this.addCapability(capability);
				}
				catch (err)
				{
					this.error(err);
				}
			}
		}

		const dd = this.getData();
		this.registerCapabilityListener('speaker_next', this.onCapabilityNext.bind(this));
		this.registerCapabilityListener('speaker_prev', this.onCapabilityPrev.bind(this));
		this.registerCapabilityListener('url_image_index', this.onCapabilityUrlImageIndex.bind(this));
		this.registerCapabilityListener('url_image_next', this.onCapabilityUrlImageNext.bind(this));
		this.registerCapabilityListener('url_image_prev', this.onCapabilityUrlImagePrev.bind(this));
		this.registerCapabilityListener('url_image_random', this.onCapabilityUrlImageRandom.bind(this));

		// Keep the index slider range in sync with the global URL list
		await this.updateUrlImageIndexOptions();
		this.onAppSettingsChanged = async (setting) =>
		{
			if (setting === 'artFrameImageUrls')
			{
				await this.updateUrlImageIndexOptions().catch(this.error);
			}
		};
		this.homey.settings.on('set', this.onAppSettingsChanged);

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

	async onOAuth2Deleted()
	{
		if (this.onAppSettingsChanged)
		{
			this.homey.settings.off('set', this.onAppSettingsChanged);
			this.onAppSettingsChanged = null;
		}

		if (this.nudgeSyncTimer)
		{
			this.homey.clearTimeout(this.nudgeSyncTimer);
			this.nudgeSyncTimer = null;
		}

		return super.onOAuth2Deleted();
	}

	/**
	 * Get the global list of image URLs that is maintained in the app settings page.
	 * @returns {string[]} the list of image URLs
	 */
	getUrlImageList()
	{
		const urls = this.homey.settings.get('artFrameImageUrls');
		if (Array.isArray(urls))
		{
			return urls.filter((url) => (typeof url === 'string') && (url.trim() !== '')).map((url) => url.trim());
		}

		if (typeof urls === 'string')
		{
			return urls.split('\n').map((url) => url.trim()).filter((url) => url !== '');
		}

		return [];
	}

	/**
	 * Update the min / max of the url_image_index slider to match the URL list size.
	 */
	async updateUrlImageIndexOptions()
	{
		if (!this.hasCapability('url_image_index'))
		{
			return;
		}

		const urlList = this.getUrlImageList();
		const max = Math.max(urlList.length, 1);

		try
		{
			const options = this.getCapabilityOptions('url_image_index');
			if (!options || (options.max !== max))
			{
				await this.setCapabilityOptions('url_image_index', { min: 1, max, step: 1 });
			}
		}
		catch (err)
		{
			await this.setCapabilityOptions('url_image_index', { min: 1, max, step: 1 }).catch(this.error);
		}

		// Clamp the current index to the new range
		const currentIndex = this.getCapabilityValue('url_image_index');
		if (!currentIndex || (currentIndex < 1))
		{
			await this.setCapabilityValue('url_image_index', 1).catch(this.error);
		}
		else if (currentIndex > max)
		{
			await this.setCapabilityValue('url_image_index', max).catch(this.error);
		}
	}

	/**
	 * Send an image URL to the frame so the SwitchBot cloud can fetch and display it.
	 * @param {string} imageUrl the URL of the image to display
	 */
	async sendImageUrl(imageUrl)
	{
		if (!imageUrl || (typeof imageUrl !== 'string') || (imageUrl.trim() === ''))
		{
			throw new Error(this.homey.__('noImageUrl'));
		}

		const result = await this.sendCommand('uploadImage', { imageUrl: imageUrl.trim() });

		if (this.getSetting('nudgeSyncAfterUpload'))
		{
			// Experimental: send a 'next' command shortly after the upload to nudge the frame to wake up and sync
			if (this.nudgeSyncTimer)
			{
				this.homey.clearTimeout(this.nudgeSyncTimer);
			}
			this.nudgeSyncTimer = this.homey.setTimeout(() =>
			{
				this.nudgeSyncTimer = null;
				this.sendCommand('next', '').catch(this.error);
			},
			5000);
		}

		return result;
	}

	/**
	 * Send the image at the given 1 based position in the global URL list to the frame.
	 * @param {number} index the 1 based position in the URL list
	 */
	async sendUrlImageByIndex(index)
	{
		const urlList = this.getUrlImageList();
		if (urlList.length === 0)
		{
			throw new Error(this.homey.__('noImageUrls'));
		}

		let newIndex = Math.round(index);
		if (newIndex < 1)
		{
			newIndex = 1;
		}
		else if (newIndex > urlList.length)
		{
			newIndex = urlList.length;
		}

		await this.sendImageUrl(urlList[newIndex - 1]);
		this.setCapabilityValue('url_image_index', newIndex).catch(this.error);
		return newIndex;
	}

	async onCapabilityUrlImageIndex(value, opts)
	{
		return this.sendUrlImageByIndex(value);
	}

	async onCapabilityUrlImageNext(value, opts)
	{
		const urlList = this.getUrlImageList();
		if (urlList.length === 0)
		{
			throw new Error(this.homey.__('noImageUrls'));
		}

		let index = (this.getCapabilityValue('url_image_index') || 0) + 1;
		if (index > urlList.length)
		{
			index = 1;
		}

		return this.sendUrlImageByIndex(index);
	}

	async onCapabilityUrlImagePrev(value, opts)
	{
		const urlList = this.getUrlImageList();
		if (urlList.length === 0)
		{
			throw new Error(this.homey.__('noImageUrls'));
		}

		let index = (this.getCapabilityValue('url_image_index') || 2) - 1;
		if (index < 1)
		{
			index = urlList.length;
		}

		return this.sendUrlImageByIndex(index);
	}

	async onCapabilityUrlImageRandom(value, opts)
	{
		const urlList = this.getUrlImageList();
		if (urlList.length === 0)
		{
			throw new Error(this.homey.__('noImageUrls'));
		}

		const currentIndex = this.getCapabilityValue('url_image_index') || 0;
		let index = Math.floor(Math.random() * urlList.length) + 1;
		if ((urlList.length > 1) && (index === currentIndex))
		{
			// Avoid showing the same image again
			index = (index % urlList.length) + 1;
		}

		return this.sendUrlImageByIndex(index);
	}

	onCapabilityNext(value, opts)
	{
		const result = this.sendCommand('next', '');

		// after 5 seconds call the getHubDeviceValues method to fetch the latest values from the hub device
		this.homey.setTimeout(() =>
		{
			this.getHubDeviceValues().catch(this.error);
		},
		5000);
		return result;
	}

	onCapabilityPrev(value, opts)
	{
		const result = this.sendCommand('previous', '');

		// after 5 seconds call the getHubDeviceValues method to fetch the latest values from the hub device
		this.homey.setTimeout(() =>
		{
			this.getHubDeviceValues().catch(this.error);
		},
		30000);
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
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0, 'hub');
		}
	}

}

module.exports = ArtFrameHubDevice;
