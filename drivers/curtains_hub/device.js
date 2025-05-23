/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class CurtainsHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		if (!this.hasCapability('open_close'))
		{
			this.addCapability('open_close').catch(this.error);;
		}
		if (!this.hasCapability('position'))
		{
			this.addCapability('position').catch(this.error);;
		}
		if (!this.hasCapability('windowcoverings_state'))
		{
			this.addCapability('windowcoverings_state').catch(this.error);;
		}

		this.invertPosition = this.getSetting('invertPosition');
		if (this.invertPosition === null)
		{
			this.invertPosition = false;
		}

		this.motionMode = Number(this.getSetting('motionMode'));
		if (this.motionMode === null)
		{
			this.motionMode = 2;
		}

		// try
		// {
		// 	await this.getHubDeviceValues();
		// }
		// catch (err)
		// {
		// 	this.setUnavailable(err.message);
		// }
		this.registerCapabilityListener('open_close', this.onCapabilityopenClose.bind(this));
		this.registerCapabilityListener('windowcoverings_set', this.onCapabilityPosition.bind(this));
		this.registerCapabilityListener('windowcoverings_state', this.onCapabilityState.bind(this));

        const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);
        this.log('CurtainsHubDevice has been initialized');
    }

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('CurtainsHubDevice has been added');
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

		if (changedKeys.indexOf('motionMode') >= 0)
		{
			this.motionMode = Number(newSettings.motionMode);
		}

		if (changedKeys.indexOf('classType') >= 0)
		{
			this.setClass(newSettings.classType);
		}
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('CurtainsHubDevice was renamed');
	}

	// this method is called when the Homey device switches the device on or off
	async onCapabilityopenClose(value, opts)
	{
		value = value ? 1 : 0;

		if (this.invertPosition)
		{
			value = 1 - value;
		}

		return this.runToPos(value * 100, this.motionMode);
	}

	// this method is called when the Homey device has requested a position change ( 0 to 1)
	async onCapabilityPosition(value, opts)
	{
		let mode = this.motionMode;

		if (opts === 'fast')
		{
			mode = 0;
		}
		else if (opts === 'slow')
		{
			mode = 1;
		}

		if (this.invertPosition)
		{
			value = 1 - value;
		}

		return this.runToPos(value * 100, mode);
	}

	async onCapabilityState(value, opts)
	{
		if (this.pollTimer)
		{
			this.homey.clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}

		if (value === 'idle')
		{
			await this.stop();
			this.pollTimer = this.homey.setTimeout(() => {
				this.getHubDeviceValues().catch(this.error);
			}, 1000);
		}
		else if (value === 'up')
		{
			return this.open();
		}
		else if (value === 'down')
		{
			return this.close();
		}

		return false;
	}

	/* ------------------------------------------------------------------
	 * open()
	 * - Open the curtain
	 *
	 * [Arguments]
	 * - none
	 *
	 * [Return value]
	 * - Promise object
	 *   Nothing will be passed to the `resolve()`.
	 * ---------------------------------------------------------------- */
	open()
	{
		return this._operateCurtain('turnOn', 'default');
	}

	/* ------------------------------------------------------------------
	 * close()
	 * - close the curtain
	 *
	 * [Arguments]
	 * - none
	 *
	 * [Return value]
	 * - Promise object
	 *   Nothing will be passed to the `resolve()`.
	 * ---------------------------------------------------------------- */
	close()
	{
		return this._operateCurtain('turnOff', 'default');
	}

	stop()
	{
		return this._operateCurtain('pause', 'default');
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
		return this._operateCurtain('setPosition', `0,${mode},${percent}`);
	}

	async _operateCurtain(command, parameter)
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
				this.homey.app.updateLog(`Curtain Hub got: ${this.homey.app.varToString(data)}`, 3);

				let position = data.slidePosition / 100;
				if (this.invertPosition)
				{
					position = 1 - position;
				}

				if (position > 0.5)
				{
					this.setCapabilityValue('open_close', true).catch(this.error);
				}
				else
				{
					this.setCapabilityValue('open_close', false).catch(this.error);
				}

				if (position === 0)
				{
					this.setCapabilityValue('windowcoverings_state', 'up').catch(this.error);
				}
				else if (position === 1)
				{
					this.setCapabilityValue('windowcoverings_state', 'down').catch(this.error);
				}
				else
				{
					this.setCapabilityValue('windowcoverings_state', data.moving ? null : 'idle').catch(this.error);
				}

				this.setCapabilityValue('windowcoverings_set', position).catch(this.error);
				this.setCapabilityValue('position', position * 100).catch(this.error);

				if (data.battery)
				{
					if (!this.hasCapability('measure_battery'))
					{
						try
						{
							await this.addCapability('measure_battery');
						}
						catch (err)
						{
							this.log(err);
						}
					}

					this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
				}
			}
			this.unsetWarning().catch(this.error);;
		}
		catch (err)
		{
			this.homey.app.updateLog(`Curtains getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
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

				if (position > 0.5)
				{
					this.setCapabilityValue('open_close', true).catch(this.error);
				}
				else
				{
					this.setCapabilityValue('open_close', false).catch(this.error);
				}

				this.setCapabilityValue('windowcoverings_set', position).catch(this.error);
				this.setCapabilityValue('position', position * 100).catch(this.error);

				if (position === 0)
				{
					this.setCapabilityValue('windowcoverings_state', 'up').catch(this.error);
				}
				else if (position === 1)
				{
					this.setCapabilityValue('windowcoverings_state', 'down').catch(this.error);
				}
				else
				{
					this.setCapabilityValue('windowcoverings_state', null).catch(this.error);
					this.pollTimer = this.homey.setTimeout(() => {
						this.getHubDeviceValues().catch(this.error);
					}, 2000);
				}

				if (data.battery)
				{
					if (!this.hasCapability('measure_battery'))
					{
						try
						{
							await this.addCapability('measure_battery')
						}
						catch (err)
						{
							this.log(err);
						}
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

module.exports = CurtainsHubDevice;
