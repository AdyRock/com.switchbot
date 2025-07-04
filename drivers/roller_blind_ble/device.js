/* jslint node: true */

'use strict';

const Homey = require('homey');

class RollerBlindBLEDevice extends Homey.Device
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		this.bestRSSI = 100;
		this.bestHub = '';
		this.sendingCommand = false;

		this._operateRollerBlind = this._operateRollerBlind.bind(this);
		this._operateBotLoop = this._operateRollerBlindLoop.bind(this);

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

		// register a capability listener
		if (this.hasCapability('open_close'))
		{
			this.registerCapabilityListener('open_close', this.onCapabilityopenClose.bind(this));
		}

		if (this.hasCapability('windowcoverings_closed'))
		{
			this.registerCapabilityListener('windowcoverings_closed', this.onCapabilityopenClose.bind(this));
		}
		this.registerCapabilityListener('windowcoverings_set', this.onCapabilityPosition.bind(this));
		this.registerCapabilityListener('windowcoverings_state', this.onCapabilityState.bind(this));

		this.homey.app.registerBLEPolling();

		this.log('RollerBlindBLEDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('RollerBlindBLEDevice has been added');
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
		this.log('RollerBlindBLEDevice was renamed');
	}

	/**
	 * onDeleted is called when the user deleted the device.
	 */
	async onDeleted()
	{
		this.homey.app.unregisterBLEPolling();
		await this.blePeripheral.disconnect();
		this.log('RollerBlindBLEDevice has been deleted');
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
			await this.pause();
			this.pollTimer = this.homey.setTimeout(() => {
				this.getDeviceValues(true).catch(this.error);
			}, 1000);
		}
		else if (value === 'up')
		{
			return this.onCapabilityopenClose(true);
		}
		else if (value === 'down')
		{
			return this.onCapabilityopenClose(false);
		}

		return Promise.resolve();
	}

	/* ------------------------------------------------------------------
	 * pause()
	 * - pause the Roller Blind
	 *
	 * [Arguments]
	 * - none
	 *
	 * [Return value]
	 * - Promise object
	 *   Nothing will be passed to the `resolve()`.
	 * ---------------------------------------------------------------- */
	async pause()
	{
		return this._operateRollerBlind([0x57, 0x0f, 0x45, 0x01, 0x00, 0xff]);
	}

	/* ------------------------------------------------------------------
	 * runToPos()
	 * - run to the targe position
	 *
	 * [Arguments]
	 * - percent | number | Required | the percentage of target position
	 * - mode | number | Optional | the Motion Mode, 0 = Silent, 1 = Performance, 3 = App setting
	 *
	 * [Return value]
	 * - Promise object
	 *   Nothing will be passed to the `resolve()`.
	 * ---------------------------------------------------------------- */
	async runToPos(percent, mode = 0xff)
	{
		this.homey.app.updateLog(`COMMAND: Setting Roller Blind to:${percent}`);
		this.setCapabilityValue('position', null).catch(this.error);
		return this._operateRollerBlind([0x57, 0x0F, 0x47, 0x01, 0x05, 0x00, mode, percent]);
	}

	async _operateRollerBlind(bytes)
	{
		const name = this.getName();
		if (this.sendingCommand)
		{
			throw new Error(`Still sending previous command for ${name}`);
		}
		this.sendingCommand = true;

		if (this.homey.app.BLEHub)
		{
			const dd = this.getData();
			if (await this.homey.app.BLEHub.sendBLEHubCommand(dd.address, bytes, this.bestHub))
			{
				this.sendingCommand = false;
				return;
			}
		}

		let loops = 5;
		let response = null;
		while (loops-- > 0)
		{
			while (this.homey.app.bleBusy)
			{
				await this.homey.app.Delay(200);
			}

			this.homey.app.bleBusy = true;
			try
			{
				response = await this._operateRollerBlindLoop(name, bytes);
				if (response === true)
				{
					this.homey.app.bleBusy = false;
					this.homey.app.updateLog(`Command complete for ${name}`);
					this.sendingCommand = false;
					return;
				}
			}
			catch (err)
			{
				this.homey.app.updateLog(`_operateBot error: ${name} : ${err.message}`, 0);
			}

			this.homey.app.bleBusy = false;

			if (loops > 0)
			{
				this.homey.app.updateLog(`Retry command (${4 - loops} of 3) for ${name} in 5 seconds`);
				await this.homey.app.Delay(5000);
			}
		}

		this.sendingCommand = false;

		if (response instanceof Error)
		{
			this.homey.app.updateLog(`!!!!!!! Command for ${name} failed\r\n`, 0);
			throw response;
		}
	}

	async _operateRollerBlindLoop(name, bytes)
	{
		let sending = true;

		try
		{
			this.homey.app.updateLog(`Looking for BLE device: ${name}`);

			const dd = this.getData();
			const bleAdvertisement = await this.homey.ble.find(dd.id);
			if (!bleAdvertisement)
			{
				this.homey.app.updateLog(`BLE device ${name} not found`, 0);
				return false;
			}

			this.homey.app.updateLog(`Connecting to BLE device: ${name}`);
			const blePeripheral = await bleAdvertisement.connect();

			this.homey.app.updateLog(`BLE device ${name} connected`);

			const reqBuf = Buffer.from(bytes);
			try
			{
				this.homey.app.updateLog(`Getting service for ${name}`);
				const bleService = await blePeripheral.getService('cba20d00224d11e69fb80002a5d5c51b');

				this.homey.app.updateLog(`Getting write characteristic for ${name}`);
				const bleCharacteristic = await bleService.getCharacteristic('cba20002224d11e69fb80002a5d5c51b');

				if (parseInt(this.homey.version, 10) >= 6)
				{
					this.homey.app.updateLog(`Getting notify characteristic for ${name}`);
					const bleNotifyCharacteristic = await bleService.getCharacteristic('cba20003224d11e69fb80002a5d5c51b');

					try
					{
						await bleNotifyCharacteristic.subscribeToNotifications((data) =>
						{
							sending = false;
							this.homey.app.updateLog(`received notification for ${name}: ${this.homey.app.varToString(data)}`);
						});
					}
					catch (err)
					{
						this.homey.app.updateLog(`subscribeToNotifications: ${name}: ${err.message}`, 0);
					}
				}

				this.homey.app.updateLog(`Writing data to ${name}`);
				await bleCharacteristic.write(reqBuf);
			}
			catch (err)
			{
				this.homey.app.updateLog(`Catch 2: ${name}: ${err.message}`, 0);
				sending = false;
				return err;
				// throw(err);
			}
			finally
			{
				this.homey.app.updateLog(`Finally 2: ${name}`);
				// wait for the command to be sent
				let retries = 6;
				while (sending && (retries-- > 0))
				{
					await this.homey.app.Delay(500);
				}

				await blePeripheral.disconnect();
				this.homey.app.updateLog(`Disconnected: ${name}`);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`Catch 1: ${name}: ${err.toString()}`, 0);
			return err;
		}
		finally
		{
			this.homey.app.updateLog(`finally 1: ${name}`);
		}

		return true;
	}

	async getDeviceValues()
	{
		const name = this.getName();
		try
		{
			const dd = this.getData();
			if (this.bestHub !== '')
			{
				// This device is being controlled by a BLE hub
				if (this.homey.app.BLEHub && this.homey.app.BLEHub.IsBLEHubAvailable(this.bestHub))
				{
					return;
				}

				this.bestHub = '';
			}

			if (dd.id)
			{
				this.homey.app.updateLog(`Finding Roller Blind BLE device ${name}`, 3);
				const bleAdvertisement = await this.homey.ble.find(dd.id);
				if (!bleAdvertisement)
				{
					this.homey.app.updateLog(`BLE device ${name} not found`);
					return;
				}

				this.homey.app.updateLog(this.homey.app.varToString(bleAdvertisement), 4);
				const rssi = await bleAdvertisement.rssi;
				this.setCapabilityValue('rssi', rssi).catch(this.error);

				const data = this.driver.parse(bleAdvertisement);
				if (data)
				{
					this.homey.app.updateLog(`Parsed Roller Blind BLE (${name}) ${this.homey.app.varToString(data)}`, 3);
					let position = data.serviceData.position / 100;
					if (this.invertPosition)
					{
						position = 1 - position;
					}

					if (this.hasCapability('open_close'))
					{
						if (position > 0.5)
						{
							this.setCapabilityValue('open_close', true).catch(this.error);
						}
						else
						{
							this.setCapabilityValue('open_close', false).catch(this.error);
						}
					}
					else if (position > 0.5)
					{
						this.setCapabilityValue('windowcoverings_closed', true).catch(this.error);
					}
					else
					{
						this.setCapabilityValue('windowcoverings_closed', false).catch(this.error);
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
						this.setCapabilityValue('windowcoverings_state', null).catch(this.error);
					}

					this.setCapabilityValue('windowcoverings_set', position).catch(this.error);
					this.setCapabilityValue('position', position * 100).catch(this.error);

					this.setCapabilityValue('measure_battery', data.serviceData.battery).catch(this.error);
					this.homey.app.updateLog(`Parsed Roller Blind BLE (${name}): position = ${data.serviceData.position}, battery = ${data.serviceData.battery}`, 3);
				}
				else
				{
					this.homey.app.updateLog(`Parsed Roller Blind BLE (${name}): No service data`, 0);
				}
			}
			else
			{
				this.setUnavailable(`SwitchBot Roller Blind BLE (${name}) no ID`);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(err.message, 2);
		}
		finally
		{
			this.homey.app.updateLog(`Finding Roller Blind device (${name}) --- COMPLETE`, 3);
		}
	}

	async syncBLEEvents(events)
	{
		const name = this.getName();
		this.homey.app.updateLog(`syncEvents for (${name})`, 3);
		try
		{
			const dd = this.getData();
			for (const event of events)
			{
				if (event.address && (event.address.localeCompare(dd.address, 'en', { sensitivity: 'base' }) === 0) && (event.serviceData.modelName === 'WoRollerBlind'))
				{
					if (this.pollTimer)
					{
						this.homey.clearTimeout(this.pollTimer);
						this.pollTimer = null;
					}

					let position = event.serviceData.position / 100;
					if (this.invertPosition)
					{
						position = 1 - position;
					}
					this.setCapabilityValue('windowcoverings_set', position).catch(this.error);
					this.setCapabilityValue('position', position * 100).catch(this.error);

					if (this.hasCapability('open_close'))
					{
						if (position > 0.5)
						{
							this.setCapabilityValue('open_close', true).catch(this.error);
						}
						else
						{
							this.setCapabilityValue('open_close', false).catch(this.error);
						}
					}
					else if (position > 0.5)
					{
						this.setCapabilityValue('windowcoverings_closed', true).catch(this.error);
					}
					else
					{
						this.setCapabilityValue('windowcoverings_closed', false).catch(this.error);
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
						this.setCapabilityValue('windowcoverings_state', null).catch(this.error);
					}

					this.setCapabilityValue('measure_battery', event.serviceData.battery).catch(this.error);
					this.setCapabilityValue('rssi', event.rssi).catch(this.error);
					this.homey.app.updateLog(`Parsed Roller Blind BLE (${name}): position = ${event.serviceData.position}, battery = ${event.serviceData.battery}`, 3);

					if (event.hubMAC && ((event.rssi < this.bestRSSI) || (event.hubMAC.localeCompare(this.bestHub, 'en', { sensitivity: 'base' }) === 0)))
					{
						this.bestHub = event.hubMAC;
						this.bestRSSI = event.rssi;
					}

					this.setAvailable();
				}
			}
		}
		catch (error)
		{
			this.homey.app.updateLog(`Error in RollerBlind (${name}) syncEvents: ${this.homey.app.varToString(error)}`, 0);
		}
	}

}

module.exports = RollerBlindBLEDevice;
