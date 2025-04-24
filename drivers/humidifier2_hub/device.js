/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class HumidityHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		// try
		// {
		// 	this.getHubDeviceValues();
		// }
		// catch (err)
		// {
		// 	this.setUnavailable(err.message);
		// }
		this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
		this.registerCapabilityListener('child_lock', this.onCapabilityChildLock.bind(this));
		this.registerMultipleCapabilityListener(['humidifier_mode', 'target_humidity'], this.onCapabilityMode.bind(this));

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id);

		this.log('HumidityHubDevice has been initialising');
	}

	// this method is called when the Homey device switches the device on or off
	async onCapabilityOnOff(value, opts)
	{
		const command = value ? 'turnOn' : 'turnOff';

		return this.sendCommand(command, 'default');
	}

	async onCapabilityChildLock(value, opts)
	{
		return this.sendCommand('setChildLock', value);
	}

	// this method is called when the Homey device mode or target humidity is changed
	async onCapabilityMode(valueOj, optsObj)
	{
		let mode = null;
		let targetHumidity = null;
		if (valueOj.humidifier_mode)
		{
			// Convert the string to an integer
			mode = parseInt(valueOj.humidifier_mode, 10);
		}
		if (valueOj.target_humidity)
		{
			// The efficiency has changed
			targetHumidity = valueOj.target_humidity.toString();
		}

		if (mode == null)
		{
			mode = this.getCapabilityValue('humidifier_mode');
		}

		if (targetHumidity == null)
		{
			targetHumidity = this.getCapabilityValue('target_humidity');
		}

		return this.sendCommand('setMode', { mode, targetHumidify: targetHumidity });
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

	async pollHubDeviceValues()
	{
		this.getHubDeviceValues();
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
				this.homey.app.updateLog(`Humidifier2 Hub got: ${this.homey.app.varToString(data)}`, 3);

				this.setCapabilityValue('onoff', data.power === 'on').catch(this.error);
				this.setCapabilityValue('humidifier_mode', data.mode).catch(this.error);
				this.setCapabilityValue('measure_humidity', data.humidity).catch(this.error);
				this.setCapabilityValue('filter_life', data.filterElement.effectiveUsageHours).catch(this.error);
				this.setCapabilityValue('filter_used_time', data.filterElement.usedHours).catch(this.error);
				this.setCapabilityValue('child_lock', data.childLock).catch(this.error);
			}
			this.unsetWarning();
		}
		catch (err)
		{
			this.homey.app.updateLog(`Humidifier2 getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
			this.setWarning(err.message);
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
				this.setCapabilityValue('onoff', message.context.power === 'on').catch(this.error);
				this.setCapabilityValue('humidifier_mode', message.context.mode.toString()).catch(this.error);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = HumidityHubDevice;
