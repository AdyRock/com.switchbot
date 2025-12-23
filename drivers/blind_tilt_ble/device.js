/* jslint node: true */

'use strict';

const Homey = require('homey');

class BlindTiltBLEDevice extends Homey.Device
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		if (!this.hasCapability('open_close'))
		{
			this.addCapability('open_close').catch(this.error);;
		}
		if (!this.hasCapability('position'))
		{
			this.addCapability('position').catch(this.error);;
		}
		if (this.hasCapability('onoff'))
		{
			this.removeCapability('onoff').catch(this.error);;
		}

		this.bestRSSI = 100;
		this.bestHub = '';
		this.sendingCommand = false;
		this.firmware = 2;

		this._operateBlind = this._operateBlind.bind(this);
		this._operateBotLoop = this._operateBlindLoop.bind(this);

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

		this.closePosition = Number(this.getSetting('closePosition'));
		if (this.closePosition === null)
		{
			this.closePosition = 'down';
		}

		// register a capability listener
		this.registerCapabilityListener('open_close', this.onCapabilityopenClose.bind(this));
		this.registerCapabilityListener('windowcoverings_tilt_set', this.onCapabilityPosition.bind(this));

		this.homey.app.registerBLEPolling();

		this.log('BlindTiltBLEDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('BlindTiltBLEDevice has been added');
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

		if (changedKeys.indexOf('closePosition') >= 0)
		{
			this.closePosition = Number(newSettings.closePosition);
		}

		setImmediate(() =>
		{
			this.getDeviceValues(true).catch(this.error);
		});
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('BlindTiltBLEDevice was renamed');
	}

	/**
	 * onDeleted is called when the user deleted the device.
	 */
	async onDeleted()
	{
		this.homey.app.unregisterBLEPolling();
		await this.blePeripheral.disconnect();
		this.log('BlindTiltBLEDevice has been deleted');
	}

	// this method is called when the Homey device switches the device on or off
	async onCapabilityopenClose(value, opts)
	{
		if (value !== this.invertPosition)
		{
			value = 0.5;
		}
		else
		{
			value = this.closePosition ? 1 : 0;
		}

		return this.runToPos(value * 100, this.motionMode);
	}

	// this method is called when the Homey device has requested a position change ( 0 to 1)
	async onCapabilityPosition(value, opts)
	{
		if (this.invertPosition)
		{
			value = 1 - value;
		}
		return this.runToPos(value * 100, this.motionMode);
	}

	/* ------------------------------------------------------------------
	 * pause()
	 * - pause the Blind Tilt
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
		return this._operateBlind([0x57, 0x0f, 0x45, 0x01, 0x00, 0xff]);
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
		this.homey.app.updateLog(`COMMAND: Setting Blind Tilt to:${percent}`);
		this.setCapabilityValue('position', null).catch(this.error);
		return this._operateBlind([0x57, 0x0f, 0x45, 0x01, 0x05, mode, percent]);
	}

	async _operateBlind(bytes)
	{
		const name = this.getName();
		if (this.sendingCommand)
		{
			throw new Error(`Still sending previous command for ${name}`);
		}
		this.sendingCommand = true;
		let loops = 3;
		const dd = this.getData();

		if (this.bestHub === '' && this.homey.app.BLEHub)
		{
			const deviceInfo = await this.homey.app.BLEHub.getBLEHubDevice(dd.address);
			if (deviceInfo)
			{
				this.bestHub = deviceInfo.hubMAC;
			}
		}
		if (this.bestHub !== '')
		{
			// This device is being controlled by a BLE hub
			if (this.homey.app.BLEHub && this.homey.app.BLEHub.IsBLEHubAvailable(this.bestHub))
			{
				while (loops-- > 0)
				{
					if (await this.homey.app.BLEHub.sendBLEHubCommand(dd.address, bytes, this.bestHub))
					{
						break;
					}
				}
				this.sendingCommand = false;

				return;
			}
		}

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
				response = await this._operateBlindLoop(name, bytes);
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
				this.homey.app.updateLog(`Retry command (${4 - loops} of 3) for ${name} in 2 seconds`);
				await this.homey.app.Delay(2000);
			}
		}

		this.sendingCommand = false;

		if (response instanceof Error)
		{
			this.homey.app.updateLog(`!!!!!!! Command for ${name} failed\r\n`, 0);
			throw response;
		}
	}

	async _operateBlindLoop(name, bytes)
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

	async getBlindInformation(name, bleAdvertisement)
	{
		let sending = true;
		let returnData = '';

		try
		{
			this.homey.app.updateLog(`Connecting to BLE device: ${name}`);
			const blePeripheral = await bleAdvertisement.connect();
			this.homey.app.updateLog(`BLE device ${name} connected`);

			const bytes = [0x57, 0x02];
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
							returnData = data;
							this.homey.app.updateLog(`received notification for ${name}: ${this.homey.app.varToString(data)}`);
						});
					}
					catch (err)
					{
						sending = false;
						this.homey.app.updateLog(`subscribeToNotifications: ${name}: ${err.toString()}`, 0);
					}
				}

				this.homey.app.updateLog(`Writing data to ${name}`);
				await bleCharacteristic.write(reqBuf);
			}
			catch (err)
			{
				this.homey.app.updateLog(`Catch 2: ${name}: ${err.toString()}`, 0);
				sending = false;
				return err;
				// throw(err);
			}
			finally
			{
				this.homey.app.updateLog(`Finally 2: ${name}`);
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

		return returnData;
	}

	updateFromNotify(name, returnBytes)
	{
		const data = this.driver._parseServiceDataForWoTilt(returnBytes);
		if (data)
		{
			this.homey.app.updateLog(`Parsed Blind Tilt BLE (${name}) ${this.homey.app.varToString(data)}`, 3);
			const position = data.position / 100;

			if ((position > 0.2) && (position < 0.8))
			{
				this.setCapabilityValue('open_close', !this.invertPosition).catch(this.error);
			}
			else
			{
				this.setCapabilityValue('open_close', this.invertPosition).catch(this.error);
			}

			this.setCapabilityValue('windowcoverings_tilt_set', position).catch(this.error);
			this.setCapabilityValue('position', position * 100).catch(this.error);

			this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
		}
		else
		{
			this.homey.app.updateLog(`Parsed Blind Tilt BLE (${name}): No service data`, 0);
		}
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
					this.updateCapabilities(deviceInfo);
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
					if (this.firmware < 2)
					{
						const bytes = [0x57, 0x02];
						if (await this.homey.app.BLEHub.sendBLEHubCommand(dd.address, bytes, this.bestHub))
						{
							this.sendingCommand = false;
							return;
						}
					}
					else
					{
						return;
					}
				}

				this.bestHub = '';
			}

			if (dd.id)
			{
				this.homey.app.updateLog(`Finding Blind Tilt BLE device ${name}`, 3);
				const bleAdvertisement = await this.homey.ble.find(dd.id);
				if (!bleAdvertisement)
				{
					this.homey.app.updateLog(`BLE device ${name} not found`);
					return;
				}

				this.homey.app.updateLog(this.homey.app.varToString(bleAdvertisement), 4);
				const { rssi } = bleAdvertisement;
				this.setCapabilityValue('rssi', rssi).catch(this.error);

				let data = null;
				if (this.firmware >= 2)
				{
					// The blind / tilt firmware v2 returns the position in the manufacture data
					data = this.driver.parse(bleAdvertisement);
				}
				else
				{
					// The blind / tilt firmware < 2 has to request the position
					const returnBytes = await this.getBlindInformation(name, bleAdvertisement);
					if ((returnBytes instanceof Error) || (returnBytes === ''))
					{
						this.homey.app.updateLog(`BLE get information for ${name} failed: ${returnBytes.toString()}`, 0);
						return;
					}

					data = this.driver._parseServiceDataForWoTilt(returnBytes);
				}

				if (data)
				{
					this.homey.app.updateLog(`Parsed Blind Tilt BLE (${name}) ${this.homey.app.varToString(data)}`, 3);
					const position = data.serviceData.position / 100;

					if ((position > 0.2) && (position < 0.8))
					{
						this.setCapabilityValue('open_close', !this.invertPosition).catch(this.error);
					}
					else
					{
						this.setCapabilityValue('open_close', this.invertPosition).catch(this.error);
					}

					this.setCapabilityValue('windowcoverings_tilt_set', position).catch(this.error);
					this.setCapabilityValue('position', position * 100).catch(this.error);

					this.setCapabilityValue('measure_battery', data.serviceData.battery).catch(this.error);
				}
				else
				{
					this.homey.app.updateLog(`Parsed Blind Tilt BLE (${name}): No service data`, 0);
				}
			}
			else
			{
				this.setUnavailable(`SwitchBot Blind Tilt BLE (${name}) no ID`);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(err.message, 0);
		}
		finally
		{
			this.homey.app.updateLog(`Finding Blind Tilt device (${name}) --- COMPLETE`, 3);
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
				if (event.address && (event.address.localeCompare(dd.address, 'en', { sensitivity: 'base' }) === 0) && (event.serviceData.modelName === 'WoBlindTilt'))
				{
					if (event.replyData)
					{
						this.updateFromNotify(name, event.replyData);
					}
					else
					{
						this.updateCapabilities(event);
					}
				}
			}
		}
		catch (error)
		{
			this.homey.app.updateLog(`Error in Blind Tilt (${name}) syncEvents: ${this.homey.app.varToString(error)}`, 0);
		}
	}

	updateCapabilities(data)
	{
		const position = data.serviceData.position / 100;
		this.setCapabilityValue('windowcoverings_tilt_set', position).catch(this.error);
		this.setCapabilityValue('position', position * 100).catch(this.error);

		if ((position > 0.2) && (position < 0.8))
		{
			this.setCapabilityValue('open_close', !this.invertPosition).catch(this.error);
		}
		else
		{
			this.setCapabilityValue('open_close', this.invertPosition).catch(this.error);
		}

		this.setCapabilityValue('measure_battery', data.serviceData.battery).catch(this.error);
		this.setCapabilityValue('rssi', data.rssi).catch(this.error);

		const name = this.getName();
		this.homey.app.updateLog(`Parsed Blind Tilt BLE (${name}): position = ${data.serviceData.position}, battery = ${data.serviceData.battery}`, 3);

		if (data.hubMAC && ((data.rssi < this.bestRSSI) || (data.hubMAC === this.bestHub)))
		{
			this.bestHub = data.hubMAC;
			this.bestRSSI = data.rssi;
		}

		this.setAvailable();
	}

}

module.exports = BlindTiltBLEDevice;
