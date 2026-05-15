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
		this.registerCapabilityListener('windowcoverings_set', this.onCapabilityPosition.bind(this));

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
		this.homey.app.updateLog(`COMMAND: Setting Roller Blind to:${percent}`, 'ble');
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
					this.homey.app.updateLog(`Command complete for ${name}`, 'ble');
					this.sendingCommand = false;
					return;
				}
			}
			catch (err)
			{
				this.homey.app.updateLog(`_operateBot error: ${name} : ${err.message}`, 0, 'ble');
			}

			this.homey.app.bleBusy = false;

			if (loops > 0)
			{
				this.homey.app.updateLog(`Retry command (${4 - loops} of 3) for ${name} in 5 seconds`, 'ble');
				await this.homey.app.Delay(5000);
			}
		}

		this.sendingCommand = false;

		if (response instanceof Error)
		{
			this.homey.app.updateLog(`!!!!!!! Command for ${name} failed\r\n`, 0, 'ble');
			throw response;
		}
	}

	async _operateRollerBlindLoop(name, bytes)
	{
		let sending = true;

		try
		{
			this.homey.app.updateLog(`Looking for BLE device: ${name}`, 'ble');

			const dd = this.getData();
			const bleAdvertisement = await this.homey.ble.find(dd.id);
			if (!bleAdvertisement)
			{
				this.homey.app.updateLog(`BLE device ${name} not found`, 2, 'ble');
				return false;
			}

			this.homey.app.updateLog(`Connecting to BLE device: ${name}`, 'ble');
			const blePeripheral = await bleAdvertisement.connect();

			this.homey.app.updateLog(`BLE device ${name} connected`, 'ble');

			const reqBuf = Buffer.from(bytes);
			try
			{
				this.homey.app.updateLog(`Getting service for ${name}`, 'ble');
				const bleService = await blePeripheral.getService('cba20d00224d11e69fb80002a5d5c51b');

				this.homey.app.updateLog(`Getting write characteristic for ${name}`, 'ble');
				const bleCharacteristic = await bleService.getCharacteristic('cba20002224d11e69fb80002a5d5c51b');

				if (parseInt(this.homey.version, 10) >= 6)
				{
					this.homey.app.updateLog(`Getting notify characteristic for ${name}`, 'ble');
					const bleNotifyCharacteristic = await bleService.getCharacteristic('cba20003224d11e69fb80002a5d5c51b');

					try
					{
						await bleNotifyCharacteristic.subscribeToNotifications((data) =>
						{
							sending = false;
							this.homey.app.updateLog(`received notification for ${name}: ${this.homey.app.varToString(data)}`, 'ble');
						});
					}
					catch (err)
					{
						this.homey.app.updateLog(`subscribeToNotifications: ${name}: ${err.message}`, 0, 'ble');
					}
				}

				this.homey.app.updateLog(`Writing data to ${name}`, 'ble');
				await bleCharacteristic.write(reqBuf);
			}
			catch (err)
			{
				this.homey.app.updateLog(`Catch 2: ${name}: ${err.message}`, 0, 'ble');
				sending = false;
				return err;
				// throw(err);
			}
			finally
			{
				this.homey.app.updateLog(`Finally 2: ${name}`, 'ble');
				// wait for the command to be sent
				let retries = 6;
				while (sending && (retries-- > 0))
				{
					await this.homey.app.Delay(500);
				}

				await blePeripheral.disconnect();
				this.homey.app.updateLog(`Disconnected: ${name}`, 'ble');
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`Catch 1: ${name}: ${err.toString()}`, 0, 'ble');
			return err;
		}
		finally
		{
			this.homey.app.updateLog(`finally 1: ${name}`, 'ble');
		}

		return true;
	}

	async getDeviceValues(ForceUpdate = false)
	{
		const name = this.getName();
		try
		{
			const dd = this.getData();
			if (((this.bestHub === '') || ForceUpdate) && this.homey.app.BLEHub)
			{
				const deviceInfo = await this.homey.app.BLEHub.getBLEHubDevice(dd.address);
				if (deviceInfo)
				{
					// make sure the service data is present and is not a string
					if (deviceInfo.serviceData && typeof deviceInfo.serviceData !== 'string')
					{
						this.updateCapabilities(deviceInfo);
						this.bestHub = deviceInfo.hubMAC;
					}
					else
					{
						this.bestHub = '';
						this.homey.app.updateLog(`BLE Hub for ${name} returned ${this.homey.app.varToString(deviceInfo)}`, 0, 'ble');
					}
				}
				else
				{
					this.bestHub = '';
				}
			}

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
				this.homey.app.updateLog(`Finding Roller Blind BLE device ${name}`, 3, 'ble');
				const bleAdvertisement = await this.homey.ble.find(dd.id);
				if (!bleAdvertisement)
				{
					this.homey.app.updateLog(`BLE device ${name} not found`, 'ble');
					return;
				}

				this.homey.app.updateLog(this.homey.app.varToString(bleAdvertisement), 4, 'ble');
				const rssi = bleAdvertisement.rssi;
				this.setCapabilityValue('rssi', rssi).catch(this.error);

				const data = this.driver.parse(bleAdvertisement);
				if (data)
				{
					this.homey.app.updateLog(`Parsed Roller Blind BLE (${name}) ${this.homey.app.varToString(data)}`, 3, 'ble');
					this.updateCapabilities(data);
				}
				else
				{
					this.homey.app.updateLog(`Parsed Roller Blind BLE (${name}): No service data`, 0, 'ble');
				}
			}
			else
			{
				this.setUnavailable(`SwitchBot Roller Blind BLE (${name}) no ID`);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(err.message, 2, 'ble');
		}
		finally
		{
			this.homey.app.updateLog(`Finding Roller Blind device (${name}) --- COMPLETE`, 3, 'ble');
		}
	}

	async syncBLEEvents(events)
	{
		const name = this.getName();
		this.homey.app.updateLog(`syncEvents for (${name})`, 3, 'ble');
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

					this.updateCapabilities(event);
				}
			}
		}
		catch (error)
		{
			this.homey.app.updateLog(`Error in RollerBlind (${name}) syncEvents: ${this.homey.app.varToString(error)}`, 0, 'ble');
		}
	}

	updateCapabilities(data)
	{
		let position = data.serviceData.position / 100;
		if (this.invertPosition)
		{
			position = 1 - position;
		}

		this.setCapabilityValue('windowcoverings_set', position).catch(this.error);
		this.setCapabilityValue('position', position * 100).catch(this.error);

		if (this.lastPosition)
		{
			if (this.lastPosition !== position)
			{
				this.homey.app.triggerPositionLessThan(this, { lastPosition: this.lastPosition, position }, { lastPosition: this.lastPosition, position }).catch(this.error);
				this.homey.app.triggerPositionGreaterThan(this, { lastPosition: this.lastPosition, position }, { lastPosition: this.lastPosition, position }).catch(this.error);
			}
		}

		this.lastPosition = position;

		if (typeof data.serviceData.battery !== 'undefined')
		{
			this.setCapabilityValue('measure_battery', data.serviceData.battery).catch(this.error);
		}

		if (typeof data.rssi !== 'undefined')
		{
			this.setCapabilityValue('rssi', data.rssi).catch(this.error);
		}

		const name = this.getName();
		this.homey.app.updateLog(`Parsed Roller Blind BLE (${name}): position = ${data.serviceData.position}, battery = ${data.serviceData.battery}`, 3, 'ble');

		if (data.hubMAC && ((data.rssi < this.bestRSSI) || (data.hubMAC.localeCompare(this.bestHub, 'en', { sensitivity: 'base' }) === 0)))
		{
			this.bestHub = data.hubMAC;
			this.bestRSSI = data.rssi;
		}

		this.setAvailable();
	}

}

module.exports = RollerBlindBLEDevice;
