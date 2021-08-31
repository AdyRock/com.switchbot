/*jslint node: true */
'use strict';

const Homey = require('homey');

class ContactBLEDevice extends Homey.Device
{
    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        this.log('ContactBLEDevice has been initialized');
        this.bestRSSI = 100;
        this.bestHub = "";

        if (!this.hasCapability("alarm_contact.left_open"))
        {
            this.addCapability("alarm_contact.left_open");
            this.addCapability("button_press_id");
        }

        this.lastButtonID = -1;
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
        await this.blePeripheral.disconnect();
        this.log('ContactBLEDevice has been deleted');
    }

    async getDeviceValues()
    {
        try
        {
            const dd = this.getData();

            if (this.bestHub !== "")
            {
                // This device is being controlled by a BLE hub
                if (this.homey.app.IsBLEHubAvailable(this.bestHub))
                {
                    return;
                }

                this.bestHub = "";
            }

            if (dd.id)
            {
                if (this.homey.app.moving === 0)
                {
                    this.homey.app.updateLog("Finding Presence BLE device", 2);
                    let bleAdvertisement = await this.homey.ble.find(dd.id);
                    this.homey.app.updateLog(this.homey.app.varToString(bleAdvertisement), 3);
                    let rssi = await bleAdvertisement.rssi;
                    this.setCapabilityValue('rssi', rssi);

                    let data = this.driver.parse(bleAdvertisement);
                    if (data)
                    {
                        this.homey.app.updateLog("Parsed Presence BLE: " + this.homey.app.varToString(data), 2);
                        this.setCapabilityValue('alarm_motion', data.serviceData.motion);
                        this.setCapabilityValue('alarm_contact', data.serviceData.contact);
                        if (this.getCapabilityValue('bright') != data.serviceData.light)
                        {
                            this.setCapabilityValue('bright', data.serviceData.light);
                            this.driver.bright_changed( this, data.serviceData.light);
                        }
                        this.setCapabilityValue('measure_battery', data.serviceData.battery);
                        this.setCapabilityValue('alarm_contact.left_open', data.serviceData.leftOpen);
                        this.setCapabilityValue('button_press_id', data.serviceData.buttonPresses);
                        this.homey.app.updateLog(`Parsed Presence BLE: battery = ${data.serviceData.battery}`, 2);
                    }
                    else
                    {
                        this.homey.app.updateLog("Parsed Presence BLE: No service data", 1);
                    }
                }
                else
                {
                    this.homey.app.updateLog("Presence Refresh skipped while moving");
                }
            }
            else
            {
                this.setUnavailable("SwitchBot BLE hub not detected");
            }
        }
        catch (err)
        {
            this.homey.app.updateLog(this.homey.app.varToString(err), 0);
        }
        finally
        {
            this.homey.app.updateLog("Finding Presence BLE device --- COMPLETE", 2);
        }
    }

    async syncBLEEvents(events)
    {
        try
        {
            const dd = this.getData();
            for (const event of events)
            {
                if (event.address && (event.address == dd.address))
                {
                    this.setCapabilityValue('alarm_motion', (event.serviceData.motion == 1));
                    this.setCapabilityValue('alarm_contact', (event.serviceData.contact == 1));

                    let light = (event.serviceData.light === 1);
                    if (this.getCapabilityValue('bright') != light)
                    {
                        this.setCapabilityValue('bright', light);
                        this.driver.bright_changed( this, light);
                    }

                    this.setCapabilityValue('button_press_id', event.serviceData.buttonPresses);
                    this.setCapabilityValue('alarm_contact.left_open', (event.serviceData.leftOpen == 1));
                    this.setCapabilityValue('measure_battery', event.serviceData.battery);
                    this.setCapabilityValue('rssi', event.rssi);

                    if (event.hubMAC && (event.rssi < this.bestRSSI) || (event.hubMAC === this.bestHub))
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
            this.homey.app.updateLog("Error in Presence syncEvents: " + this.homey.app.varToString(error), 0);
        }
    }

}

module.exports = ContactBLEDevice;