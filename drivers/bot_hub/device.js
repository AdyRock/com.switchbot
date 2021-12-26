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

    // this method is called when the Homey device has requested a position change ( 0 to 1)
    async onCapabilityOnOff(value, opts)
    {
        const pushButton = this.getSetting('push_button');
        if (pushButton)
        {
            if (value === true)
            {
                await this._operateBot('press');
                this.homey.setTimeout(() => this.setCapabilityValue('onoff', false), 1000).catch(this.error);
            }
        }
        else if (value)
        {
            this._operateBot('turnOn');
        }
        else
        {
            this._operateBot('turnOff');
        }
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
                this.homey.app.updateLog(`Bot Hub got: ${data.power}`);
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
            this.log('getHubDeviceValues: ', err);
            this.setUnavailable(err.message);
        }
    }

}

module.exports = BotHubDevice;
