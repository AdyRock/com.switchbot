/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class BlindTiltHubDevice extends HubDevice
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
        this.registerCapabilityListener('windowcoverings_tilt_set', this.onCapabilityPosition.bind(this));
        this.log('BlindTiltHubDevice has been initialising');
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded()
    {
        this.log('BlindTiltHubDevice has been added');
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
    }

    /**
     * onRenamed is called when the user updates the device's name.
     * This method can be used this to synchronise the name to the device.
     * @param {string} name The new name
     */
    async onRenamed(name)
    {
        this.log('BlindTiltHubDevice was renamed');
    }

    // this method is called when the Homey device has requested a position change ( 0 to 1)
    async onCapabilityPosition(value, opts)
    {
        if (value == 0)
        {
            return this._operateCurtain('closeDown', '');
        }
        if (value == 1)
        {
            return this._operateCurtain('closeUp', '');
        }
        if ((value > 0.4) && (value < 0.6))
        {
            return this._operateCurtain('fullyOpen', '');
        }
        if (value >= 0.5)
        {
            return this._operateCurtain('setPosition', `up;${parseInt((1 - value) * 200)}`);
        }
        return this._operateCurtain('setPosition', `down;${parseInt(value * 200)}`);
    }

    async _operateCurtain(command, parameter)
    {
        this.setCapabilityValue('windowcoverings_tilt_set', null).catch(this.error);
        const data = {
            command,
            parameter,
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
                this.homey.app.updateLog(`Curtain Hub got: ${this.homey.app.varToString(data)}`, 3);

                let position = data.slidePosition / 100;
                this.setCapabilityValue('windowcoverings_tilt_set', position).catch(this.error);

                if (data.battery)
                {
                    if (!this.hasCapability('measure_battery'))
                    {
                        await this.addCapability('measure_battery');
                    }
            
                    this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
                }

                this.unsetWarning();
            }
        }
        catch (err)
        {
            this.homey.app.updateLog(`BlindTilt getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
            this.setWarning(err.message);
        }
    }

}

module.exports = BlindTiltHubDevice;
