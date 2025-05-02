/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class SmartFanHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		// try
		// {
		// 	await this.getHubDeviceValues();
		// }
		// catch (err)
		// {
		// 	this.setUnavailable(err.message);
		// }

		this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
		this.registerMultipleCapabilityListener(['smart_fan_mode', 'smart_fan_speed', 'smart_fan_shake_range'], this.onCapabilityFanSettings.bind(this));

		this.log('SmartFanHubDevice has been initialising');
	}

	// this method is called when the Homey device switches the device on or off
	async onCapabilityOnOff(value, opts)
	{
		const command = value ? 'turnOn' : 'turnOff';

		return this.sendCommand(command, 'default');
	}

	// this method is called when the Homey smart fan device has requested a change
	async onCapabilityFanSettings(valueOj, optsObj)
	{
		let mode = this.getCapabilityValue('smart_fan_mode');
		let speed = this.getCapabilityValue('smart_fan_speed');
		let shake = this.getCapabilityValue('smart_fan_shake_range');

		if (valueOj.fan_mode)
		{
			// Mode is true
			mode = valueOj.fan_mode;
		}

		if (valueOj.fan_speed)
		{
			// The efficiency has changed
			speed = valueOj.fan_speed;
		}

		if (valueOj.shake_range)
		{
			// mode must have been false so get the last efficiency
			shake = valueOj.shake_range;
		}

		const parameters = `on,${mode},${speed},${shake}`;
		return this.sendCommand('setAllStatus', parameters);
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
				this.homey.app.updateLog(`Smart Fan Hub got: ${this.homey.app.varToString(data)}`, 3);

				this.setCapabilityValue('onoff', data.power === 'on').catch(this.error);
				this.setCapabilityValue('smart_fan_mode', data.mode).catch(this.error);
				this.setCapabilityValue('smart_fan_speed', data.speed).catch(this.error);
				this.setCapabilityValue('smart_fan_shake_range', data.shakeRange).catch(this.error);
			}
			this.unsetWarning().catch(this.error);;
		}
		catch (err)
		{
			this.homey.app.updateLog(`Fan getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
			this.setWarning(err.message);
		}
	}

}

module.exports = SmartFanHubDevice;
