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
		this.registerMultipleCapabilityListener(['air_purifier_mode', 'fan_level'], this.onCapabilityMode.bind(this));

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

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
		return this.sendCommand('setChildLock', value ? 1 : 0);
	}

	// this method is called when the Homey device mode or target humidity is changed
	async onCapabilityMode(valueOj, optsObj)
	{
		let mode = null;
		let fanGear = null;

		if (valueOj.air_purifier_mode)
		{
			mode = parseInt(valueOj.air_purifier_mode, 10);
		}
		else
		{
			mode = this.getCapabilityValue('air_purifier_mode');
		}

		if (valueOj.fan_level)
		{
			fanGear = parseInt(valueOj.fan_level, 10);
		}
		else
		{
			fanGear = this.getCapabilityValue('fan_level');
		}

		if (mode === 1)
		{
			return this.sendCommand('setMode', { mode, fanGear });
		}

		return this.sendCommand('setMode', { mode });
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

				this.setCapabilityValue('onoff', data.power === 'ON').catch(this.error);
				this.setCapabilityValue('air_purifier_mode', data.mode.toString()).catch(this.error);
				this.setCapabilityValue('child_lock', (data.childLock === 1)).catch(this.error);
			}
			this.unsetWarning().catch(this.error);
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
				this.setCapabilityValue('onoff', message.context.power === 'ON').catch(this.error);
				this.setCapabilityValue('air_purifier_mode', message.context.mode.toString()).catch(this.error);
				this.setCapabilityValue('child_lock', (message.context.childLock === 1)).catch(this.error);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = AirPurifierHubDevice;
