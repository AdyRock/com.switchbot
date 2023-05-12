/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class LockHubDevice extends HubDevice
{

    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        await super.onInit();

        this.registerCapabilityListener('locked', this.onCapabilityLocked.bind(this));

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

        this.log('LockHubDevice has been initialized');
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded()
    {
        this.log('LockHubDevice has been added');
    }

    /**
     * onRenamed is called when the user updates the device's name.
     * This method can be used this to synchronise the name to the device.
     * @param {string} name The new name
     */
    async onRenamed(name)
    {
        this.log('LockHubDevice was renamed');
    }

    async onSettings({ oldSettings, newSettings, changedKeys })
    {
        // Called when settings changed
    }

    // this method is called when the Homey device has requested a position change ( 0 to 1)
    async onCapabilityLocked(value, opts)
    {
        if (value)
        {
            return this._operateBot('lock');
        }
        else
        {
            return this._operateBot('unlock');
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
                this.homey.app.updateLog(`Lock Hub got: ${this.homey.app.varToString(data)}`, 3);

                this.setCapabilityValue('locked', data.lockState === 'locked').catch(this.error);

                if (data.battery)
                {
                    if (!this.hasCapability('measure_battery'))
                    {
                        await this.addCapability('measure_battery');
                    }
            
                    this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
                }
            }
            this.unsetWarning();
        }
        catch (err)
        {
            this.homey.app.updateLog(`Lock getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
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
                this.setCapabilityValue('locked', message.context.lockState === 'LOCKED').catch(this.error);

                if (message.context.battery)
                {
                    if (!this.hasCapability('measure_battery'))
                    {
                        await this.addCapability('measure_battery');
                    }
            
                    this.setCapabilityValue('measure_battery', message.context.battery).catch(this.error);
                }
            }
        }
        catch (err)
        {
            this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
        }
    }

}

module.exports = LockHubDevice;
