/* jslint node: true */

'use strict';

const Homey = require('homey');
const crc = require('crc-32');

class PlugBLEDevice extends Homey.Device
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		this._operatePlug = this._operatePlug.bind(this);
		this._operatePlugLoop = this._operatePlugLoop.bind(this);

		this.bestRSSI = 100;
		this.bestHub = '';
		this.sendingCommand = false;
		this.deviceNotFound = false;

		// register a capability listener
		this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));

		this.homey.app.registerBLEPolling();

		this.log('PlugBLEDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('PlugBLEDevice has been added');
	}

	/**
	 * onSettings is called when the user updates the device's settings.
	 * @param {object} event the onSettings event data
	 * @param {object} event.oldSettings The old settings object
	 * @param {object} event.newSettings The new settings object
	 * @param {string[]} event.changedKeys An array of keys changed since the previous version
	 * @returns {Promise<string|void>} return a custom message that will be displayed
	 */
	async onSettings({ Settings, newSettings, changedKeys })
	{
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('PlugBLEDevice was renamed');
	}

	/**
	 * onDeleted is called when the user deleted the device.
	 */
	async onDeleted()
	{
		this.homey.app.unregisterBLEPolling();
		await this.blePeripheral.disconnect();
		this.log('PlugBLEDevice has been deleted');
	}

	// this method is called when the Homey device has requested a position change ( 0 to 1)
	async onCapabilityOnOff(value, opts)
	{
		this.homey.app.updateLog(`COMMAND: Setting plug state to:${value}`);

		let cmd = [];
		if (value)
		{
			cmd = [0x57, 0x0F, 0x50, 0x01, 0x01, 0x80];
		}
		else
		{
			cmd = [0x57, 0x0F, 0x50, 0x01, 0x01, 0x00];
		}
		await this._operatePlug(cmd);
		return;
	}

	async _operatePlug(bytes)
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
				response = await this._operatePlugLoop(name, bytes);
				if (response.status && (response.status === true))
				{
					this.homey.app.bleBusy = false;
					this.homey.app.updateLog(`Command complete for ${name}`);
					this.sendingCommand = false;
					return;
				}
			}
			catch (err)
			{
				this.homey.app.updateLog(`_operatePlug error: ${name} : ${err.message}`, 0);
			}

			this.homey.app.bleBusy = false;

			if (loops > 0)
			{
				this.homey.app.updateLog(`Retry command for ${name} in 2 seconds`);
				await this.homey.app.Delay(2000);
			}
		}

		if (response instanceof Error)
		{
			this.homey.app.updateLog(`!!!!!!! Command for ${name} failed\r\n`, 0);
			this.sendingCommand = false;
			throw response;
		}
	}

	async _operatePlugLoop(name, bytes, checkPolling = true)
	{
		const returnStatue = { status: false, notificationData: [] };

		let sending = true;

		try
		{
			this.homey.app.updateLog(`Finding BLE device: ${name}`);

			const dd = this.getData();
			const bleAdvertisement = await this.homey.ble.find(dd.id);
			if (!bleAdvertisement)
			{
				this.homey.app.updateLog(`BLE device ${name} not found`, 0);
				return returnStatue;
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

					await bleNotifyCharacteristic.subscribeToNotifications((data) =>
					{
						sending = false;
						returnStatue.notificationData = data;
						this.homey.app.updateLog(`received notification for ${name}: ${this.homey.app.varToString(data)}`);
					});
				}

				this.homey.app.updateLog(`Writing data to ${name}`);
				await bleCharacteristic.write(reqBuf);
			}
			catch (err)
			{
				this.homey.app.updateLog(`Catch 2: ${name}: ${err.message}`);
				sending = false;
				return err;
			}
			finally
			{
				this.homey.app.updateLog(`Finally 2: ${name}`);
				let retries = 10;
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
			this.homey.app.updateLog(`Catch 1: ${name}: ${err.message}`, 0);
			return err;
		}
		finally
		{
			this.homey.app.updateLog(`finally 1: ${name}`);
		}

		returnStatue.status = true;
		return returnStatue;
	}

	async getDeviceValues()
	{
		if (this.sendingCommand)
		{
			return;
		}

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
				this.homey.app.updateLog(`Finding plug BLE device ${name}`, 2);

				const bleAdvertisement = await this.homey.ble.find(dd.id);
				if (!bleAdvertisement)
				{
					this.homey.app.updateLog(`BLE device ${name} not found`);
					return;
				}

				this.homey.app.updateLog(this.homey.app.varToString(bleAdvertisement), 4);
				const rssi = bleAdvertisement.rssi;
				this.setCapabilityValue('rssi', rssi).catch(this.error);

				const data = this.driver.parse(bleAdvertisement);
				if (data)
				{
					this.homey.app.updateLog(`Parsed Plug BLE (${name}) ${this.homey.app.varToString(data)}`, 3);

					this.setAvailable();
					this.deviceNotFound = false;
					this.setCapabilityValue('onoff', data.serviceData.state).catch(this.error);

					this.homey.app.updateLog(`Parsed Plug BLE (${name}): onoff = ${data.serviceData.state}, battery = ${data.serviceData.battery}`, 3);
				}
				else
				{
					this.homey.app.updateLog(`Parsed Plug BLE (${name}): No service data`, 0);
				}
			}
			else
			{
				this.setUnavailable(`SwitchPlug Plug BLE (${name}) no ID`);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(err.message, this.deviceNotFound ? 2 : 0);
			this.deviceNotFound = true;
		}
		finally
		{
			this.homey.app.updateLog(`Finding Plug device (${name}) --- COMPLETE`, 3);
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
				if (event.address && (event.address.localeCompare(dd.address, 'en', { sensitivity: 'base' }) === 0))
				{
					this.homey.app.updateLog(`Got Plug state of: ${event.serviceData.state}`);
					this.setCapabilityValue('onoff', (event.serviceData.state === 0)).catch(this.error);

					this.setCapabilityValue('rssi', event.rssi).catch(this.error);

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
			this.homey.app.updateLog(`Error in Plug (${name}) syncEvents: ${this.homey.app.varToString(error)}`, 0);
		}
	}

}

module.exports = PlugBLEDevice;
