/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class SmartFanNewHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
		this.registerCapabilityListener('fan_speed', this.onCapabilityFanSpeed.bind(this));
		this.registerCapabilityListener('smart_fan_mode2', this.onCapabilityFanMode.bind(this));
		this.registerCapabilityListener('night_light', this.onCapabilityNightLight.bind(this));

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		this.log('SmartFanNewHubDevice has been initialising');
	}

	// this method is called when the Homey device switches the device on or off
	async onCapabilityOnOff(value, opts)
	{
		const command = value ? 'turnOn' : 'turnOff';
		return this.sendCommand(command, 'default');
	}

	// this method is called when the Homey smart fan device has requested a change
	async onCapabilityFanMode(value, opts)
	{
		return this.sendCommand('setWindMode', value);
	}

	async onCapabilityFanSpeed(value, opts)
	{
		return this.sendCommand('setWindSpeed', value * 100);
	}

	async onCapabilityNightLight(value, opts)
	{
		return this.sendCommand('setNightLightMode', value);
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
		try
		{
			const data = await this._getHubDeviceValues();
			if (data)
			{
				this.setAvailable();
				this.homey.app.updateLog(`Smart Fan New Hub got: ${this.homey.app.varToString(data)}`, 3, 'hub');

				this.setCapabilityValue('onoff', data.power === 'on').catch(this.error);
				this.setCapabilityValue('smart_fan_mode2', data.mode).catch(this.error);
				this.setCapabilityValue('fan_speed', data.fanSpeed / 100).catch(this.error);
				this.setCapabilityValue('night_light', data.nightStatus).catch(this.error);
				this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
			}
			this.unsetWarning().catch(this.error);;
		}
		catch (err)
		{
			this.homey.app.updateLog(`Smart Fan New Hub getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0, 'hub');
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
				this.setCapabilityValue('onoff', message.context.powerState === 'ON').catch(this.error);
				this.setCapabilityValue('fan_speed', message.context.fanSpeed / 100).catch(this.error);
				this.setCapabilityValue('smart_fan_mode2', message.context.mode).catch(this.error);
				this.setCapabilityValue('night_light', message.context.nightStatus).catch(this.error);
				if (typeof message.context.battery !== 'undefined')
				{
					this.setCapabilityValue('measure_battery', message.context.battery).catch(this.error);
				}
				this.homey.app.updateLog(`Smart Fan New Hub got webhook message: ${this.homey.app.varToString(message)}`, 3, 'hub');
				this.unsetWarning().catch(this.error);;
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0, 'hub');
		}
	}

}

module.exports = SmartFanNewHubDevice;
