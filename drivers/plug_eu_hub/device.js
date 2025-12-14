/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class PlugEUHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		this.log('PlugEUHubDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('PlugEUHubDevice has been added');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('PlugEUHubDevice was renamed');
	}

	async onSettings({ oldSettings, newSettings, changedKeys })
	{
		// Called when settings changed
	}

	// this method is called when the Homey device has requested a position change ( 0 to 1)
	async onCapabilityOnOff(value, opts)
	{
		if (value)
		{
			return this._operatePlug('turnOn');
		}

		return this._operatePlug('turnOff');
	}

	async _operatePlug(command)
	{
		const data = {
			command,
			parameter: 'default',
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
				this.homey.app.updateLog(`Plug Hub got: ${this.homey.app.varToString(data)}`, 3);

				if (data.switchStatus !== undefined)
				{
					this.setCapabilityValue('onoff', (data.switchStatus === 1)).catch(this.error);
				}
				if (data.electricCurrent !== undefined)
				{
					this.setCapabilityValue('measure_current', data.electricCurrent / 1000).catch(this.error);
					this.setCapabilityValue('measure_voltage', data.voltage).catch(this.error);
					this.setCapabilityValue('measure_power', data.power).catch(this.error);
					this.setCapabilityValue('meter_power', data.usedElectricity / 60000).catch(this.error);
				}
			}
			this.unsetWarning().catch(this.error);
		}
		catch (err)
		{
			this.homey.app.updateLog(`Plug getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
			this.setWarning(err.message).catch(this.error);;
		}
	}

	async pollHubDeviceValues()
	{
		// The webhook is only triggerd for on/off so we need polling for the motion and bright state
		this.getHubDeviceValues();
		return true;
	}

	async processWebhookMessage(message)
	{
		try
		{
			const dd = this.getData();
			if (dd.id === message.context.deviceMac)
			{
				// message is for this device
				const data = message.context;
				if (data.switchStatus !== undefined)
				{
					this.setCapabilityValue('onoff', (data.switchStatus === 1)).catch(this.error);
					this.getHubDeviceValues();
				}
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = PlugEUHubDevice;
