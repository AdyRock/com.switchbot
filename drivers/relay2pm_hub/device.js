/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class Relay2pmHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		this.initialised = false;
		await super.onInit();

		this.registerCapabilityListener('onoff.one', this.onCapabilityOnOff.bind(this, '1'));
		this.registerCapabilityListener('onoff.two', this.onCapabilityOnOff.bind(this, '2'));

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		this.initialised = true;

		this.log('Relay2pmHubDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('Relay2pmHubDevice has been added');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('Relay2pmHubDevice was renamed');
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
	async onCapabilityOnOff(channel, value, opts)
	{
		if (!value)
		{
			return this._operateBot('turnOff', channel);
		}

		return this._operateBot('turnOn', channel);
	}

	async _operateBot(command, channel)
	{
		const data = {
			command,
			parameter: channel,
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
				this.homey.app.updateLog(`Relay 2PM Hub got: ${this.homey.app.varToString(data)}`, 3);

				this.setCapabilityValue('onoff.one', data.switch1Status === 1).catch(this.error);
				this.setCapabilityValue('onoff.two', data.switch2Status === 1).catch(this.error);

				this.setCapabilityValue('measure_voltage.one', data.switch1Voltage).catch(this.error);
				this.setCapabilityValue('measure_voltage.two', data.switch2Voltage).catch(this.error);

				this.setCapabilityValue('measure_power.one', data.switch1Power).catch(this.error);
				this.setCapabilityValue('measure_power.two', data.switch2Power).catch(this.error);

				this.setCapabilityValue('measure_current.one', data.switch1ElectricCurrent / 1000).catch(this.error);
				this.setCapabilityValue('measure_current.two', data.switch2ElectricCurrent / 1000).catch(this.error);

				this.setCapabilityValue('meter_power.one', data.switch1UsedElectricity / 1000 / 60).catch(this.error);
				this.setCapabilityValue('meter_power.two', data.switch2UsedElectricity / 1000 / 60).catch(this.error);
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
				this.homey.app.updateLog(`Relay 2PM processWebhookMessage: ${this.homey.app.varToString(data)}`, 3);

				if (data.switch1Status !== undefined)
				{
					this.setCapabilityValue('onoff.one', data.switch1Status === 1).catch(this.error);
				}

				if (data.switch2Status !== undefined)
				{
					this.setCapabilityValue('onoff.two', data.switch2Status === 1).catch(this.error);
				}

				if (data.switch1Overload !== undefined)
				{
					this.setCapabilityValue('alarm_power.one', data.switch1Overload === 1).catch(this.error);
				}

				if (data.switch2Overload !== undefined)
				{
					this.setCapabilityValue('alarm_power.two', data.switch2Overload === 1).catch(this.error);
				}
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`Relay 2PM processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = Relay2pmHubDevice;
