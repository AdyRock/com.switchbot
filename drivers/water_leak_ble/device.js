/* jslint node: true */

'use strict';

const Homey = require('homey');

class WaterLeakBLEDevice extends Homey.Device
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		this.bestRSSI = 100;
		this.bestHub = '';

		this.homey.app.registerBLEPolling();
		this.log('WaterLeakBLEDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('WaterLeakBLEDevice has been added');
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
		this.log('WaterLeakBLEDevice settings where changed');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('WaterLeakBLEDevice was renamed');
	}

	/**
	 * onDeleted is called when the user deleted the device.
	 */
	async onDeleted()
	{
		this.homey.app.unregisterBLEPolling();
		await this.blePeripheral.disconnect();
		this.log('WaterLeakBLEDevice has been deleted');
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
				this.homey.app.updateLog('Finding Water Leak BLE device', 3);
				const bleAdvertisement = await this.homey.ble.find(dd.id);
				if (!bleAdvertisement)
				{
					const name = this.getName();
					this.homey.app.updateLog(`BLE device ${name} not found`);
					return;
				}

				this.homey.app.updateLog(this.homey.app.varToString(bleAdvertisement), 4);
				const { rssi } = bleAdvertisement;
				this.setCapabilityValue('rssi', rssi).catch(this.error);

				const data = this.driver.parse(bleAdvertisement);
				if (data)
				{
					this.homey.app.updateLog(`Parsed Water Leak BLE: ${this.homey.app.varToString(data)}`, 3);
					this.setCapabilityValue('alarm_water', data.serviceData.status).catch(this.error);
					this.setCapabilityValue('measure_battery', data.serviceData.battery).catch(this.error);
				}
				else
				{
					this.homey.app.updateLog('Parsed Water Leak BLE: No service data', 0);
				}
			}
			else
			{
				this.setUnavailable('SwitchBot BLE hub not detected');
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(err.message, 0);
		}
		finally
		{
			this.homey.app.updateLog('Finding Water Leak BLE device --- COMPLETE', 3);
		}
	}

	async syncBLEEvents(events)
	{
		try
		{
			const dd = this.getData();
			for (const event of events)
			{
				if (event.address && (event.address.localeCompare(dd.address, 'en', { sensitivity: 'base' }) === 0) && (event.serviceData.modelName === 'WoWaterLeak'))
				{
					this.setCapabilityValue('alarm_water', (event.serviceData.status === 1)).catch(this.error);
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
			this.homey.app.updateLog(`Error in Water Leak syncEvents: ${this.homey.app.varToString(error)}`, 0);
		}
	}

}

module.exports = WaterLeakBLEDevice;
