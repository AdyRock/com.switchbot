/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class BotHubDevice extends HubDevice
{

    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        await super.onInit();

        this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));

        this.log('BotHubDevice has been initialized');
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded()
    {
        this.log('BotHubDevice has been added');
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

    async onSettings({ oldSettings, newSettings, changedKeys })
    {
        // Called when settings changed
        if ((changedKeys.indexOf('push_button') >= 0) && (oldSettings.push_button !== newSettings.push_button))
        {
            if (newSettings.push_button)
            {
                this.setClass('button');
            }
            else
            {
                this.setClass('socket');
            }
        }
    }

    // this method is called when the Homey device has requested a position change ( 0 to 1)
    async onCapabilityOnOff(value, opts)
    {
        const pushButton = this.getSetting('push_button');
        if (pushButton)
        {
            if (value === true)
            {
                const result = await this._operateBot('press');
                this.homey.setTimeout(() => this.setCapabilityValue('onoff', false).catch(this.error), 1000);
                return result;
            }
        }
        else if (value)
        {
            return this._operateBot('turnOn');
        }
        else
        {
            return this._operateBot('turnOff');
        }

        return true;
    }

    async _operateBot(command)
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
                this.homey.app.updateLog(`Bot Hub got: ${this.homey.app.varToString(data)}`, 3);

                const pushButton = this.getSetting('push_button');
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
            this.homey.app.updateLog(`getHubDeviceValues: : ${this.homey.app.varToString(err)}`, 0);
            this.setUnavailable(err.message);
        }
    }

}

module.exports = BotHubDevice;
