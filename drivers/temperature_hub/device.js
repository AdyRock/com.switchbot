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

        const dd = this.getData();
        this.homey.app.registerHomeyWebhook(dd.id);

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
        try
        {
            const data = await this._getHubDeviceValues();
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

    async processWebhookMessage(message)
    {
        try
        {
            const dd = this.getData();
            if (dd.id === message.context.deviceMac)
            {
                // message is for this device
                let { temperature } = message.context;
                if (message.context.scale !== 'CELSIUS')
                {
                    // Convert F to C
                    temperature = ((temperature - 32) * 5) / 9;
                }

                this.setCapabilityValue('measure_temperature', temperature).catch(this.error);
                this.setCapabilityValue('measure_humidity', message.context.humidity).catch(this.error);
            }
        }
        catch (err)
        {
            this.homey.app.updateLog(`processWebhookMessage error ${err.message}`);
        }
    }

}

module.exports = TemperatureHubDevice;
