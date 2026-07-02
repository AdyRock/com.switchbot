/* jslint node: true */

'use strict';

const Homey = require('homey');

class PresenceBLEDevice extends Homey.Device
{

	formatMacAddress(value)
	{
		if (!value)
		{
			return value;
		}

		const macText = String(value);
		if (macText.includes(':'))
		{
			return macText;
		}

		const hexText = macText.replace(/[^a-fA-F0-9]/g, '');
		if (hexText.length !== 12)
		{
			return macText;
		}

		return hexText.match(/.{1,2}/g).join(':').toUpperCase();
	}

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		this.bestRSSI = 100;
		this.bestHub = '';
		this.homey.app.registerBLEPolling(this);
		this.log('PresenceBLEDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('PresenceBLEDevice has been added');
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
		this.log('PresenceBLEDevice settings where changed');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('PresenceBLEDevice was renamed');
	}

	/**
	 * onDeleted is called when the user deleted the device.
	 */
	async onDeleted()
	{
		this.homey.app.unregisterBLEPolling(this);
		await this.blePeripheral.disconnect();
		this.log('PresenceBLEDevice has been deleted');
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
				const deviceMac = this.formatMacAddress(dd.address || dd.id);
				this.homey.app.updateLog('Finding Presence BLE device', 3, 'ble');
				const bleAdvertisement = await this.homey.ble.find(dd.id);
				if (!bleAdvertisement)
				{
					const name = this.getName();
					this.homey.app.updateLog(`BLE device ${name} (MAC: ${deviceMac}) not found`, 'ble');
					return;
				}

				this.homey.app.updateLog(this.homey.app.varToString(bleAdvertisement), 4, 'ble');
				const rssi = bleAdvertisement.rssi;
				this.setCapabilityValue('rssi', rssi).catch(this.error);

				const data = this.driver.parse(bleAdvertisement);
				if (data)
				{
					this.homey.app.updateLog(`Parsed Presence BLE (MAC: ${deviceMac}): ${this.homey.app.varToString(data)}`, 3, 'ble');
					this.setCapabilityValue('alarm_motion', data.serviceData.motion).catch(this.error);
					if (this.getCapabilityValue('bright') !== data.serviceData.light)
					{
						this.setCapabilityValue('bright', data.serviceData.light).catch(this.error);
						const device = this;
						this.driver.bright_changed(device, data.serviceData.light);
					}
					this.setCapabilityValue('measure_battery', data.serviceData.battery).catch(this.error);
					this.homey.app.updateLog(`Parsed Presence BLE (MAC: ${deviceMac}): battery = ${data.serviceData.battery}`, 3, 'ble');
				}
				else
				{
					this.homey.app.updateLog(`Parsed Presence BLE (MAC: ${deviceMac}): No service data`, 3, 'ble');
				}
			}
			else
			{
				this.setUnavailable('SwitchBot BLE hub not detected');
			}
		}
		catch (err)
		{
			const dd = this.getData();
			const deviceMac = this.formatMacAddress(dd.address || dd.id);
			const message = (err && err.message) ? err.message : String(err);
			if (/Peripheral\s+Not\s+Found/i.test(message))
			{
				this.homey.app.updateLog(`${message} (MAC: ${deviceMac})`, 0, 'ble');
			}
			else
			{
				this.homey.app.updateLog(message, 0, 'ble');
			}
		}
		finally
		{
			this.homey.app.updateLog('Finding Presence BLE device --- COMPLETE', 3, 'ble');
		}
	}

	async syncBLEEvents(events)
	{
		try
		{
			const dd = this.getData();
			for (const event of events)
			{
				if (event.address && (event.address.localeCompare(dd.address, 'en', { sensitivity: 'base' }) === 0) && (event.serviceData.modelName === 'WoPresence'))
				{
					this.setCapabilityValue('alarm_motion', (event.serviceData.motion === 1)).catch(this.error);
					this.setCapabilityValue('bright', (event.serviceData.light === 1)).catch(this.error);
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
			this.homey.app.updateLog(`Error in Presence syncEvents: ${this.homey.app.varToString(error)}`, 0, 'ble');
		}
	}

}

module.exports = PresenceBLEDevice;

