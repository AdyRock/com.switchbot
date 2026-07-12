/* jslint node: true */

'use strict';

const LightHubDevice = require('../light_hub_device');

class RGBICWWCeilingLightHubDevice extends LightHubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		if (this.hasCapability('onoff'))
		{
			this.registerCapabilityListener('onoff', this.onCapabilityMainOnOff.bind(this));
		}
		if (this.hasCapability('onoff.colour'))
		{
			this.registerCapabilityListener('onoff.colour', this.onCapabilityColorOnOff.bind(this));
		}
		if (this.hasCapability('dim'))
		{
			this.registerCapabilityListener('dim', this.onCapabilityMainDim.bind(this));
		}
		if (this.hasCapability('dim.colour'))
		{
			this.registerCapabilityListener('dim.colour', this.onCapabilityColorDim.bind(this));
		}

		if (this.hasCapability('light_temperature'))
		{
			this.registerCapabilityListener('light_temperature', this.onCapabilityLightTemperature.bind(this));
		}

		if (this.hasCapability('light_hue') && this.hasCapability('light_saturation'))
		{
			this.registerMultipleCapabilityListener(['light_hue', 'light_saturation'], this.onCapabilityLightHueSat.bind(this), 500);
		}

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);
		this.log('RGBICWWCeilingLightHubDevice has been initialized');
	}

	async onCapabilityMainOnOff(value)
	{
		const command = value ? 'turnOnMainLight' : 'turnOffMainLight';
		return this.sendCommand(command, 'default');
	}

	async onCapabilityColorOnOff(value)
	{
		const command = value ? 'turnOnColorLight' : 'turnOffColorLight';
		return this.sendCommand(command, 'default');
	}

	async onCapabilityMainDim(value)
	{
		const command = 'setMainLightBrightness';
		return this.sendCommand(command, value * 100);
	}

	async onCapabilityColorDim(value)
	{
		const command = 'setColorLightBrightness';
		return this.sendCommand(command, value * 100);
	}

	async onCapabilityLightTemperature(value)
	{
		const temperatureValue = Math.round(((1 - value) * (6500 - 2700)) + 2700);
		const command = 'setMainLightColorTemp';
		return this.sendCommand(command, temperatureValue);
	}

	async onCapabilityLightHueSat(capabilityValues)
	{
		const dim = 0.5;
		const rgb = this.hslToRgb(capabilityValues.light_hue, capabilityValues.light_saturation, dim);

		const command = 'setColorLightRGB';
		return this.sendCommand(command, `${rgb[0]}:${rgb[1]}:${rgb[2]}`);
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

	updateChannelCapabilities(status)
	{
		const oldColorOn = this.hasCapability('onoff.colour') ? this.getCapabilityValue('onoff.colour') : null;
		const oldColorDim = this.hasCapability('dim.colour') ? this.getCapabilityValue('dim.colour') : null;

		const mainLightPower = String(status.mainLightPower || status.powerState || '').toLowerCase();
		if (mainLightPower != '')
		{
			this.setCapabilityValue('onoff', mainLightPower === 'on').catch(this.error);
		}

		const colorLightPower = String(status.colorLightPower || status.colorLightPowerState || '').toLowerCase();
		if (colorLightPower != '')
		{
			const newColorOn = colorLightPower === 'on';
			this.setCapabilityValue('onoff.colour', newColorOn).catch(this.error);
			if ((oldColorOn !== null) && (oldColorOn !== newColorOn))
			{
				if (newColorOn)
				{
					this.driver.triggerColorOn(this, null, null);
				}
				else
				{
					this.driver.triggerColorOff(this, null, null);
				}
			}
		}

		const mainDim = Number.parseInt(status.mainLightBrightness ?? status.brightness, 10);
		if (Number.isFinite(mainDim) && mainDim > 0)
		{
			this.setCapabilityValue('dim', Math.max(0.01, Math.min(1, mainDim / 100))).catch(this.error);
		}

		const colorDim = Number.parseInt(status.colorLightBrightness, 10);
		if (Number.isFinite(colorDim) && colorDim > 0)
		{
			const newColorDim = Math.max(0.01, Math.min(1, colorDim / 100));
			this.setCapabilityValue('dim.colour', newColorDim).catch(this.error);
			if ((oldColorDim !== null) && (Math.abs(newColorDim - oldColorDim) > 0.0001))
			{
				this.driver.triggerColorDimChanged(this, { brightness: newColorDim }, null);
			}
		}

		const colorTemp = Number.parseInt(status.mainLightColorTemp ?? status.colorTemperature, 10);
		if (Number.isFinite(colorTemp) && colorTemp >= 2700 && colorTemp <= 6500)
		{
			this.setCapabilityValue('light_temperature', 1 - (colorTemp - 2700) / (6500 - 2700)).catch(this.error);
		}

		const colorValueRaw = status.colorLightRGB || status.colorLightColor;
		if (colorValueRaw)
		{
			const rgb = colorValueRaw.split(':');
			if (Array.isArray(rgb) && rgb.length >= 3)
			{
				const hsl = this.rgbToHsl(Number(rgb[0]), Number(rgb[1]), Number(rgb[2]));
				this.setCapabilityValue('light_hue', hsl[0] / 360).catch(this.error);
				this.setCapabilityValue('light_saturation', hsl[1] / 100).catch(this.error);
			}
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
				this.homey.app.updateLog(`RGBICWW Ceiling Light Hub got: ${this.homey.app.varToString(data)}`, 3, 'hub');
				this.updateChannelCapabilities(data);
				this.unsetWarning().catch(this.error);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`RGBICWW Ceiling Light getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0, 'hub');
			this.setWarning(err.message).catch(this.error);
		}
	}

	async processWebhookMessage(message)
	{
		try
		{
			const dd = this.getData();
			if (dd.id === message.context.deviceMac)
			{
				this.updateChannelCapabilities(message.context);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`RGBICWW Ceiling Light processWebhookMessage error ${err.message}`, 0, 'hub');
		}
	}

}

module.exports = RGBICWWCeilingLightHubDevice;
