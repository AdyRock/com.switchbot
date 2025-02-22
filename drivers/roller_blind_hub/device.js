/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class RollerBlindHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		this.invertPosition = this.getSetting('invertPosition');
		if (this.invertPosition === null)
		{
			this.invertPosition = false;
		}

		try
		{
			await this.getHubDeviceValues();
		}
		catch (err)
		{
			this.setUnavailable(err.message);
		}
		this.registerCapabilityListener('windowcoverings_set', this.onCapabilityPosition.bind(this));

        const dd = this.getData();
        this.homey.app.registerHomeyWebhook(dd.id);
        this.log('RollerBlindHubDevice has been initialized');
    }

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('RollerBlindHubDevice has been added');
	}

	/**
	 * onSettings is called when the user updates the device's settings.
	 * @param {object} event the onSettings event data
	 * @param {object} event.oldSettings The old settings object
	 * @param {object} event.newSettings The new settings object
	 * @param {string[]} event.changedKeys An array of keys changed since the previous version
	 * @returns {Promise<string|void>} return a custom message that will be displayed
	 */
	async onSettings({ oldSettings, newSettings, changedKeys })
	{
		if (changedKeys.indexOf('invertPosition') >= 0)
		{
			this.invertPosition = newSettings.invertPosition;
		}
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('RollerBlindHubDevice was renamed');
	}

	// this method is called when the Homey device has requested a position change ( 0 to 1)
	async onCapabilityPosition(value, opts)
	{
		if (this.invertPosition)
		{
			value = 1 - value;
		}

		return this.runToPos(value * 100);
	}

	/* ------------------------------------------------------------------
	 * runToPos()
	 * - run to the targe position
	 *
	 * [Arguments]
	 * - percent | number | Required | the percentage of target position
	 *
	 * [Return value]
	 * - Promise object
	 *   Nothing will be passed to the `resolve()`.
	 * ---------------------------------------------------------------- */
	async runToPos(percent, mode = 0xff)
	{
		return this._operateRollerBlind('setPosition', `0,${mode},${percent}`);
	}

	async _operateRollerBlind(command, parameter)
	{
		this.setCapabilityValue('position', null).catch(this.error);
		const data = {
			command,
			parameter,
			commandType: 'command',
		};

		return super.setDeviceData(data);
	}

	async pollHubDeviceValues()
	{
		const dd = this.getData();
		if (!dd.type)
		{
			this.getHubDeviceValues();
			return true;
		}

		return false;
	}

	async getHubDeviceValues()
	{
		try
		{
			const data = await this._getHubDeviceValues();
			if (data)
			{
				this.setAvailable();
				this.homey.app.updateLog(`Roller Blind Hub got: ${this.homey.app.varToString(data)}`, 3);

				let position = data.slidePosition / 100;
				if (this.invertPosition)
				{
					position = 1 - position;
				}

				this.setCapabilityValue('windowcoverings_set', position).catch(this.error);
				this.setCapabilityValue('position', position * 100).catch(this.error);

				if (data.battery)
				{
					if (!this.hasCapability('measure_battery'))
					{
						await this.addCapability('measure_battery');
					}

					this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
				}
			}
			this.unsetWarning();
		}
		catch (err)
		{
			this.homey.app.updateLog(`Roller Blinds getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
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
				if (this.pollTimer)
				{
					this.homey.clearTimeout(this.pollTimer);
					this.pollTimer = null;
				}

				const data = message.context;
				let position = data.slidePosition / 100;
				if (this.invertPosition)
				{
					position = 1 - position;
				}

				this.setCapabilityValue('windowcoverings_set', position).catch(this.error);
				this.setCapabilityValue('position', position * 100).catch(this.error);

				if (data.battery)
				{
					if (!this.hasCapability('measure_battery'))
					{
						await this.addCapability('measure_battery');
					}

					this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
				}
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = RollerBlindHubDevice;
