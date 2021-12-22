/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class TemperatureHubDevice extends HubDevice
{

    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        await super.onInit();

        try
        {
            this.getHubDeviceValues();
        }
        catch (err)
        {
            this.setUnavailable(err.message);
        }

        this.log('TemperatureHubDevice has been initialized');
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded()
    {
        this.log('TemperatureHubDevice has been added');
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

    async getHubDeviceValues()
    {
        const dd = this.getData();

        try
        {
            const data = await this.driver.getDeviceData(dd.id);
            if (data)
            {
                this.setAvailable();
                this.setCapabilityValue('measure_temperature', data.temperature).catch(this.error);
                this.setCapabilityValue('measure_humidity', data.humidity).catch(this.error);
            }
        }
        catch (err)
        {
            this.log('getHubDeviceValues: ', err);
            this.setUnavailable(err.message);
        }
    }

}

module.exports = TemperatureHubDevice;
