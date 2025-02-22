/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class AirPurifierHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		try
		{
			this.getHubDeviceValues();
		}
		catch (err)
		{
			this.setUnavailable(err.message);
		}
		this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
		this.registerCapabilityListener('child_lock', this.onCapabilityChildLock.bind(this));
		this.registerMultipleCapabilityListener(['air_purifier_mode', 'fan_level'], this.onCapabilityMode.bind(this));

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id);

		this.log('AirPurifierHubDevice has been initialising');
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
		let fanGear = null;
		if (valueOj.air_purifier_mode)
		{
			// Convert the string to an integer
			mode = parseInt(valueOj.air_purifier_mode, 10);
			fanGear = this.getCapabilityValue('fan_level');
		}
		else if (valueOj.fan_level)
		{
			// The efficiency has changed
			fanGear = parseInt(valueOj.fan_level, 10);
			mode = this.getCapabilityValue('air_purifier_mode');
		}
		else
		{
			return false;
		}

		return this.sendCommand('setMode', { mode, fanGear });
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
				this.homey.app.updateLog(`AirPurifierHubDevice got: ${this.homey.app.varToString(data)}`, 3);

				this.setCapabilityValue('onoff', data.power === 'on').catch(this.error);
				this.setCapabilityValue('air_purifier_mode', data.mode.toString()).catch(this.error);
				this.setCapabilityValue('child_lock', data.childLock).catch(this.error);
			}
			this.unsetWarning();
		}
		catch (err)
		{
			this.homey.app.updateLog(`AirPurifierHubDevice getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
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
				this.setCapabilityValue('air_purifier_mode', message.context.mode.toString()).catch(this.error);
				this.setCapabilityValue('alarm_drying', message.context.drying).catch(this.error);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = AirPurifierHubDevice;
