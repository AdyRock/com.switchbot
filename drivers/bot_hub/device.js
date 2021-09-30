/*jslint node: true */
'use strict';

const Homey = require('homey');

class BotHubDevice extends Homey.Device
{
    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        this.log('BotHubDevice has been initialized');

        try
        {
            this.getHubDeviceValues();
        }
        catch(err)
        {
            this.setUnavailable(err.message);
        }
        this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded()
    {
        this.log('BotHubDevice has been added');
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
        this.log('BotHubDevice settings where changed');
    }

    /**
     * onRenamed is called when the user updates the device's name.
     * This method can be used this to synchronise the name to the device.
     * @param {string} name The new name
     */
    async onRenamed(name)
    {
        this.log('BotHubDevice was renamed');
    }

    /**
     * onDeleted is called when the user deleted the device.
     */
    async onDeleted()
    {
        this.log('BotHubDevice has been deleted');
    }

    // this method is called when the Homey device has requested a position change ( 0 to 1)
    async onCapabilityOnOff(value, opts)
    {
        let pushButton = this.getSetting('push_button');
        if (pushButton)
        {
            if (value === true)
            {
                let retValue = await this._operateBot('press');
                this.homey.setTimeout(() => this.setCapabilityValue('onoff', false), 1000).catch(this.error);
                return retValue;
            }
        }
        else
        {
            if (value)
            {
                return this._operateBot('turnOn');
            }
            else
            {
                return this._operateBot('turnOff');
            }
        }
    }

    async _operateBot(command)
    {
        let data = {
            "command": command,
            "parameter": "default",
            "commandType": "command"
        };

        const dd = this.getData();

        return this.driver.setDeviceData(dd.id, data);
    }

    async getHubDeviceValues()
    {
        const dd = this.getData();

        try
        {
            let data = await this.driver.getDeviceData(dd.id);
            if (data)
            {
                this.setAvailable();
                this.homey.app.updateLog("Bot Hub got: " + data.power);
                let pushButton = this.getSetting('push_button');
                if (pushButton)
                {
                    this.setCapabilityValue('onoff', false).catch(this.error);
                }
                else
                {
                    this.setCapabilityValue('onoff', data.power === 'on').catch(this.error);
                }
            }
        }
        catch (err)
        {
            this.log('getHubDeviceValues: ', err);
            this.setUnavailable(err.message);

        }
    }
}

module.exports = BotHubDevice;