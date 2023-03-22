/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class CurtainsHubDevice extends HubDevice
{

    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        await super.onInit();

        if (!this.hasCapability('open_close'))
        {
            this.addCapability('open_close');
        }
        if (!this.hasCapability('position'))
        {
            this.addCapability('position');
        }

        this.invertPosition = this.getSetting('invertPosition');
        if (this.invertPosition === null)
        {
            this.invertPosition = false;
        }

        this.motionMode = Number(this.getSetting('motionMode'));
        if (this.motionMode === null)
        {
            this.motionMode = 2;
        }

        try
        {
            this.getHubDeviceValues();
        }
        catch (err)
        {
            this.setUnavailable(err.message);
        }
        this.registerCapabilityListener('open_close', this.onCapabilityopenClose.bind(this));
        this.registerCapabilityListener('windowcoverings_set', this.onCapabilityPosition.bind(this));
        this.log('CurtainsHubDevice has been initialising');
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded()
    {
        this.log('CurtainsHubDevice has been added');
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
        if (changedKeys.indexOf('invertPosition') >= 0)
        {
            this.invertPosition = newSettings.invertPosition;
        }

        if (changedKeys.indexOf('motionMode') >= 0)
        {
            this.motionMode = Number(newSettings.motionMode);
        }
    }

    /**
     * onRenamed is called when the user updates the device's name.
     * This method can be used this to synchronise the name to the device.
     * @param {string} name The new name
     */
    async onRenamed(name)
    {
        this.log('CurtainsHubDevice was renamed');
    }

    // this method is called when the Homey device switches the device on or off
    async onCapabilityopenClose(value, opts)
    {
        value = value ? 1 : 0;

        if (this.invertPosition)
        {
            value = 1 - value;
        }

        return this.runToPos(value * 100, this.motionMode);
    }

    // this method is called when the Homey device has requested a position change ( 0 to 1)
    async onCapabilityPosition(value, opts)
    {
        if (this.invertPosition)
        {
            value = 1 - value;
        }

        return this.runToPos(value * 100, this.motionMode);
    }

    /* ------------------------------------------------------------------
     * open()
     * - Open the curtain
     *
     * [Arguments]
     * - none
     *
     * [Return value]
     * - Promise object
     *   Nothing will be passed to the `resolve()`.
     * ---------------------------------------------------------------- */
    open()
    {
        return this._operateCurtain('turnOn', 'default');
    }

    /* ------------------------------------------------------------------
     * close()
     * - close the curtain
     *
     * [Arguments]
     * - none
     *
     * [Return value]
     * - Promise object
     *   Nothing will be passed to the `resolve()`.
     * ---------------------------------------------------------------- */
    close()
    {
        return this._operateCurtain('turnOff', 'default');
    }

    /* ------------------------------------------------------------------
     * runToPos()
     * - run to the targe position
     *
     * [Arguments]
     * - percent | number | Required | the percentage of target position
     *
     * [Return value]
     * - Promise object
     *   Nothing will be passed to the `resolve()`.
     * ---------------------------------------------------------------- */
    async runToPos(percent, mode = 0xff)
    {
        return this._operateCurtain('setPosition', `0,${mode},${percent}`);
    }

    async _operateCurtain(command, parameter)
    {
        this.setCapabilityValue('position', null).catch(this.error);
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
                if (this.invertPosition)
                {
                    position = 1 - position;
                }

                if (position > 0.5)
                {
                    this.setCapabilityValue('open_close', true).catch(this.error);
                }
                else
                {
                    this.setCapabilityValue('open_close', false).catch(this.error);
                }

                this.setCapabilityValue('windowcoverings_set', position).catch(this.error);
                this.setCapabilityValue('position', position * 100).catch(this.error);

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
            this.homey.app.updateLog(`Curtains getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
            this.setWarning(err.message);
        }
    }

}

module.exports = CurtainsHubDevice;
