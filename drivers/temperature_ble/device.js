/* jslint node: true */

'use strict';

const Homey = require('homey');

class TemperatureBLEDevice extends Homey.Device
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		this.bestRSSI = 100;
		this.bestHub = '';
		this.homey.app.registerBLEPolling();
		this.log('TemperatureBLEDevice has been initialized');
		this.deviceNotFound = false;
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('TemperatureBLEDevice has been added');
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
		this.log('TemperatureBLEDevice settings where changed');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('TemperatureBLEDevice was renamed');
	}

	/**
	 * onDeleted is called when the user deleted the device.
	 */
	async onDeleted()
	{
		this.homey.app.unregisterBLEPolling();
		await this.blePeripheral.disconnect();
		this.log('TemperatureBLEDevice has been deleted');
	}

	async getDeviceValues()
	{
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
				this.homey.app.updateLog('Finding Temperature BLE device', 3);
				const bleAdvertisement = await this.homey.ble.find(dd.id);
				if (!bleAdvertisement)
				{
					const name = this.getName();
					this.homey.app.updateLog(`BLE device ${name} not found`);
					return;
				}

				this.homey.app.updateLog(this.homey.app.varToString(bleAdvertisement), 4);
				const rssi = await bleAdvertisement.rssi;
				this.setCapabilityValue('rssi', rssi).catch(this.error);

				const data = this.driver.parse(bleAdvertisement);
				if (data)
				{
					this.homey.app.updateLog(`Parsed Temperature BLE: ${this.homey.app.varToString(data)}`, 3);
					this.setCapabilityValue('measure_temperature', data.serviceData.temperature.c).catch(this.error);
					this.setCapabilityValue('measure_humidity', data.serviceData.humidity).catch(this.error);
					this.setCapabilityValue('measure_battery', data.serviceData.battery).catch(this.error);
					this.homey.app.updateLog(`Parsed Temperature BLE: temperature = ${data.serviceData.temperature.c}, humidity = ${data.serviceData.humidity}, battery = ${data.serviceData.battery}`, 2);
					this.deviceNotFound = false;
				}
				else
				{
					this.homey.app.updateLog('Parsed Temperature BLE: No service data', 0);
				}
			}
			else
			{
				this.setUnavailable('SwitchBot BLE hub not detected', 0);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(err.message, this.deviceNotFound ? 2 : 0);
			this.deviceNotFound = true;
		}
		finally
		{
			this.homey.app.updateLog('Finding Temperature BLE device --- COMPLETE', 3);
		}
	}

	async syncBLEEvents(events)
	{
		try
		{
			const dd = this.getData();
			for (const event of events)
			{
				if (event.address && (event.address.localeCompare(dd.address, 'en', { sensitivity: 'base' }) === 0) && ((event.serviceData.modelName === 'WoSensorTH') || (event.serviceData.modelName === 'WoIOSensor')))
				{
					this.setCapabilityValue('measure_temperature', event.serviceData.temperature.c).catch(this.error);
					this.setCapabilityValue('measure_humidity', event.serviceData.humidity).catch(this.error);
					this.setCapabilityValue('measure_battery', event.serviceData.battery).catch(this.error);
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
			this.homey.app.updateLog(`Error in temperature syncEvents: ${this.homey.app.varToString(error)}`, 0);
		}
	}

}

module.exports = TemperatureBLEDevice;
