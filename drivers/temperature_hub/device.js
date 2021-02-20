'use strict';

const Homey = require('homey');

class TemperatureHubDevice extends Homey.Device
{
    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        this.log('TemperatureHubDevice has been initialized');

        this.getHubDeviceValues();
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded()
    {
        this.log('TemperatureHubDevice has been added');
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
        this.log('TemperatureHubDevice settings where changed');
    }

    /**
     * onRenamed is called when the user updates the device's name.
     * This method can be used this to synchronise the name to the device.
     * @param {string} name The new name
     */
    async onRenamed(name)
    {
        this.log('TemperatureHubDevice was renamed');
    }

    /**
     * onDeleted is called when the user deleted the device.
     */
    async onDeleted()
    {
        this.log('TemperatureHubDevice has been deleted');
    }

    async getHubDeviceValues()
    {
        const dd = this.getData();

        let data = await this.driver.getDeviceData(dd.id);
        if (data)
        {
            this.setCapabilityValue('measure_temperature', data.temperature);
            this.setCapabilityValue('measure_humidity', data.humidity);
        }
    }
}

module.exports = TemperatureHubDevice;