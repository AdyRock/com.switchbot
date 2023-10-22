/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class PlugHubDevice extends HubDevice
{

    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        await super.onInit();

        this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));

        try
        {
            await this.getHubDeviceValues();
        }
        catch (err)
        {
            this.setUnavailable(err.message);
        }

        const dd = this.getData();
        this.homey.app.registerHomeyWebhook(dd.id);

        this.log('PlugHubDevice has been initialized');
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded()
    {
        this.log('PlugHubDevice has been added');
    }

    /**
     * onRenamed is called when the user updates the device's name.
     * This method can be used this to synchronise the name to the device.
     * @param {string} name The new name
     */
    async onRenamed(name)
    {
        this.log('PlugHubDevice was renamed');
    }

    async onSettings({ oldSettings, newSettings, changedKeys })
    {
        // Called when settings changed
    }

    // this method is called when the Homey device has requested a position change ( 0 to 1)
    async onCapabilityOnOff(value, opts)
    {
        if (value)
        {
            return this._operatePlug('turnOn');
        }
        else
        {
            return this._operatePlug('turnOff');
        }

        return true;
    }

    async _operatePlug(command)
    {
        const data = {
            command,
            parameter: 'default',
            commandType: 'command',
        };

        return super.setDeviceData(data);
    }

    async getHubDeviceValues()
    {
        try
        {
            const data = await this._getHubDeviceValues();
            if (data)
            {
                this.setAvailable();
                this.homey.app.updateLog(`Plug Hub got: ${this.homey.app.varToString(data)}`, 3);

                this.setCapabilityValue('onoff', data.power === 'on').catch(this.error);
                if (data.electricCurrent)
                {
                    this.setCapabilityValue('measure_power', data.electricCurrent).catch(this.error);
                }
            }
            this.unsetWarning();
        }
        catch (err)
        {
            this.homey.app.updateLog(`Plug getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
            this.setWarning(err.message);
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
                const data = message.context;
                this.setCapabilityValue('onoff', data.power === 'on').catch(this.error);

                if (data.electricCurrent)
                {
                    this.setCapabilityValue('measure_power', data.electricCurrent).catch(this.error);
                }
            }
        }
        catch (err)
        {
            this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
        }
    }

}

module.exports = PlugHubDevice;
