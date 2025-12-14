/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class GarageDoorOpenerDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		this.initialised = false;
		await super.onInit();

		this.registerCapabilityListener('open_close', this.onCapabilityOpenClose.bind(this));

		if (!this.hasCapability('alarm_contact'))
		{
			this.addCapability('alarm_contact').catch(this.error);
		}

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		this.initialised = true;

		this.log('GarageDoorOpenerDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('GarageDoorOpenerDevice has been added');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('GarageDoorOpenerDevice was renamed');
	}

	async onSettings({ oldSettings, newSettings, changedKeys })
	{
	}

	// this method is called when the Homey device has requested a position change ( 0 to 1)
	async onCapabilityOpenClose(value, opts)
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
				this.homey.app.updateLog(`Garage Door Opener got: ${this.homey.app.varToString(data)}`, 3);
				const oldopenClosedStatus = this.getCapabilityValue('open_close');
				const newDoorStatus = data.doorStatus === 0;

				this.setCapabilityValue('open_close', newDoorStatus).catch(this.error);
				if (oldopenClosedStatus !== newDoorStatus)
				{
					this.driver.onOpenClosedChangeTrigger(this, newDoorStatus, null).catch(this.error);
				}

				this.setCapabilityValue('alarm_contact', newDoorStatus).catch(this.error);
			}
			this.unsetWarning().catch(this.error);
		}
		catch (err)
		{
			this.homey.app.updateLog(`Garage Door Opener getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
			this.setWarning(err.message).catch(this.error);;
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

				const oldopenClosedStatus = this.getCapabilityValue('open_close');
				const newDoorStatus = data.doorStatus === 0;

				this.setCapabilityValue('open_close', newDoorStatus).catch(this.error);
				if (oldopenClosedStatus !== newDoorStatus)
				{
					this.driver.onOpenClosedChangeTrigger(this, newDoorStatus, null).catch(this.error);
				}

				this.setCapabilityValue('alarm_contact', newDoorStatus).catch(this.error);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = GarageDoorOpenerDevice;
