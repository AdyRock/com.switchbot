'use strict';

const Homey = require('homey');
const { ManagerBLE } = require('homey');

class CurtainsHubDevice extends Homey.Device
{
    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        this.log('CurtainsHubDevice has been initialized');
        this._driver = this.getDriver();

        this.getDeviceValues();
        this.registerCapabilityListener('windowcoverings_set', this.onCapabilityPosition.bind(this));
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
        this.log('CurtainsHubDevice settings where changed');
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

    /**
     * onDeleted is called when the user deleted the device.
     */
    async onDeleted()
    {
        this.log('CurtainsHubDevice has been deleted');
    }

    // this method is called when the Homey device has requested a position change ( 0 to 1)
    async onCapabilityPosition(value, opts)
    {
        return await this.runToPos(value * 100);
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
    async runToPos(percent, mode)
    {

        if (mode == null)
        {
            mode = 0xff;
        }
        else
        {
            if (mode > 1) { mode = 0xff; }
        }

        return this._operateCurtain('setPosition', '0,' + mode + ',' + percent);
    }

    async _operateCurtain(command, parameter)
    {
        let data = {
            "command": command,
            "parameter": parameter,
            "commandType": "command"        
        }

        const dd = this.getData();


        return this._driver.setDeviceData(dd.id, data);
    }

    async getDeviceValues()
    {
        const dd = this.getData();

        let data = await this._driver.getDeviceData(dd.id);
        if (data)
        {
            this.setCapabilityValue('windowcoverings_set', data.slidePosition / 100);
        }
    }
}

module.exports = CurtainsHubDevice;