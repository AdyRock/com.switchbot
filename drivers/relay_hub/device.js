/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class RelayHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		this.initialised = false;
		await super.onInit();

		this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		if (dd.type === 'Relay Switch 1')
		{
			if (this.hasCapability('measure_voltage'))
			{
				this.removeCapability('measure_voltage').catch(this.error);
			}
			if (this.hasCapability('measure_power'))
			{
				this.removeCapability('measure_power').catch(this.error);
			}
			if (this.hasCapability('measure_current'))
			{
				this.removeCapability('measure_current').catch(this.error);
			}
			if (this.hasCapability('meter_power'))
			{
				this.removeCapability('meter_power').catch(this.error);
			}
		}

		this.initialised = true;

		// try
		// {
		// 	await this.getHubDeviceValues();
		// }
		// catch (err)
		// {
		// 	this.setUnavailable(err.message);
		// }

		this.log('RelayHubDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('RelayHubDevice has been added');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('RelayHubDevice was renamed');
	}

	async onSettings({ oldSettings, newSettings, changedKeys })
	{
		// Called when settings changed
		if ((changedKeys.indexOf('classType') >= 0) && (oldSettings.classType !== newSettings.classType))
		{
			this.setClass(oldSettings.classType);
		}
	}

	// this method is called when the Homey device has requested a position change ( 0 to 1)
	async onCapabilityOnOff(value, opts)
	{
		if (!value)
		{
			return this._operateBot('turnOff');
		}

		return this._operateBot('turnOn');
	}

	async _operateBot(command)
	{
		const data = {
			command,
			parameter: 'default',
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
		if (!this.initialised)
		{
			return;
		}

		try
		{
			const data = await this._getHubDeviceValues();
			if (data)
			{
				this.setAvailable();
				this.homey.app.updateLog(`Relay Hub got: ${this.homey.app.varToString(data)}`, 3);

				this.setCapabilityValue('onoff', data.switchStatus === 1).catch(this.error);
				if (this.hasCapability('measure_voltage'))
				{
					this.setCapabilityValue('measure_voltage', data.voltage).catch(this.error);
					this.setCapabilityValue('measure_power', data.power).catch(this.error);
					this.setCapabilityValue('measure_current', data.electricCurrent).catch(this.error);
					this.setCapabilityValue('meter_power', data.usedElectricity).catch(this.error);
				}
			}
			this.unsetWarning().catch(this.error);;
		}
		catch (err)
		{
			this.homey.app.updateLog(`Bot getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
			this.setWarning(err.message);
		}
	}

	async processWebhookMessage(message)
	{
		if (!this.initialised)
		{
			return;
		}

		try
		{
			const dd = this.getData();
			if (dd.id === message.context.deviceMac)
			{
				// message is for this device
				const data = message.context;
				this.homey.app.updateLog(`processWebhookMessage: ${this.homey.app.varToString(data)}`, 3);
				this.setCapabilityValue('onoff', data.switchStatus === 1).catch(this.error);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = RelayHubDevice;
