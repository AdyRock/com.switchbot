/* jslint node: true */

'use strict';

const Homey = require('homey');

class ContactBLEDevice extends Homey.Device
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		this.bestRSSI = 100;
		this.bestHub = '';

		if (!this.hasCapability('alarm_contact.left_open'))
		{
			this.addCapability('alarm_contact.left_open');
			this.addCapability('button_press_id');
		}
		if (!this.hasCapability('entry_id'))
		{
			this.addCapability('entry_id');
			this.addCapability('exit_id');
		}

		this.homey.app.registerBLEPolling();
		this.log('ContactBLEDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('ContactBLEDevice has been added');
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
		this.log('ContactBLEDevice settings where changed');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('ContactBLEDevice was renamed');
	}

	/**
	 * onDeleted is called when the user deleted the device.
	 */
	async onDeleted()
	{
		this.homey.app.unregisterBLEPolling();
		await this.blePeripheral.disconnect();
		this.log('ContactBLEDevice has been deleted');
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
				this.homey.app.updateLog('Finding Presence BLE device', 3);
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
					this.homey.app.updateLog(`Parsed Presence BLE: ${this.homey.app.varToString(data)}`, 3);
					this.setCapabilityValue('alarm_motion', data.serviceData.motion).catch(this.error);
					this.setCapabilityValue('alarm_contact', data.serviceData.contact).catch(this.error);
					if (this.getCapabilityValue('bright') !== data.serviceData.light)
					{
						this.setCapabilityValue('bright', data.serviceData.light).catch(this.error);
						const device = this;
						this.driver.bright_changed(device, data.serviceData.light);
					}
					this.setCapabilityValue('measure_battery', data.serviceData.battery).catch(this.error);
					this.setCapabilityValue('alarm_contact.left_open', data.serviceData.leftOpen).catch(this.error);
					this.setCapabilityValue('button_press_id', data.serviceData.buttonPresses).catch(this.error);
					this.setCapabilityValue('entry_id', data.serviceData.entryCount).catch(this.error);
					this.setCapabilityValue('exit_id', data.serviceData.exitCount).catch(this.error);
				}
				else
				{
					this.homey.app.updateLog('Parsed Presence BLE: No service data', 0);
				}
			}
			else
			{
				this.setUnavailable('SwitchBot BLE hub not detected');
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(this.homey.app.varToString(err), 0);
		}
		finally
		{
			this.homey.app.updateLog('Finding Presence BLE device --- COMPLETE', 3);
		}
	}

	async syncBLEEvents(events)
	{
		try
		{
			const dd = this.getData();
			for (const event of events)
			{
				if (event.address && (event.address === dd.address) && (event.serviceData.modelName === 'WoContact'))
				{
					this.setCapabilityValue('alarm_motion', (event.serviceData.motion === 1)).catch(this.error);
					this.setCapabilityValue('alarm_contact', (event.serviceData.contact === 1)).catch(this.error);

					const light = (event.serviceData.light === 1);
					if (this.getCapabilityValue('bright') !== light)
					{
						this.setCapabilityValue('bright', light).catch(this.error);
						this.driver.bright_changed(this, light);
					}

					this.setCapabilityValue('button_press_id', event.serviceData.buttonPresses).catch(this.error);
					this.setCapabilityValue('entry_id', event.serviceData.entryCount).catch(this.error);
					this.setCapabilityValue('exit_id', event.serviceData.exitCount).catch(this.error);
					this.setCapabilityValue('alarm_contact.left_open', (event.serviceData.leftOpen === 1)).catch(this.error);
					this.setCapabilityValue('measure_battery', event.serviceData.battery).catch(this.error);
					this.setCapabilityValue('rssi', event.rssi).catch(this.error);

					if (event.hubMAC && ((event.rssi < this.bestRSSI) || (event.hubMAC === this.bestHub)))
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
			this.homey.app.updateLog(`Error in Presence syncEvents: ${this.homey.app.varToString(error)}`, 0);
		}
	}

}

module.exports = ContactBLEDevice;
