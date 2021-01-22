'use strict';

const Homey = require('homey');
const { ManagerBLE } = require('homey');

class MyDevice extends Homey.Device
{
    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        this.log('MyDevice has been initialized');
        this._driver = this.getDriver();

        try
        {
            this.getDeviceValues();
        }
        catch (err)
        {
            this.log(err);
        }

        // register a capability listener
        this.registerCapabilityListener('windowcoverings_set', this.onCapabilityPosition.bind(this));
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded()
    {
        this.log('MyDevice has been added');
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
        this.log('MyDevice settings where changed');
    }

    /**
     * onRenamed is called when the user updates the device's name.
     * This method can be used this to synchronise the name to the device.
     * @param {string} name The new name
     */
    async onRenamed(name)
    {
        this.log('MyDevice was renamed');
    }

    /**
     * onDeleted is called when the user deleted the device.
     */
    async onDeleted()
    {
        await this.blePeripheral.disconnect();
        this.log('MyDevice has been deleted');
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
        return this._operateCurtain([0x57, 0x0f, 0x4501, 0x05, 0xff, 0x00]);
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
        return this._operateCurtain([0x57, 0x0f, 0x45, 0x01, 0x05, 0xff, 0x64]);
    }

    /* ------------------------------------------------------------------
     * pause()
     * - pause the curtain
     *
     * [Arguments]
     * - none
     *
     * [Return value]
     * - Promise object
     *   Nothing will be passed to the `resolve()`.
     * ---------------------------------------------------------------- */
    pause()
    {
        return this._operateCurtain([0x57, 0x0f, 0x45, 0x01, 0x00, 0xff]);
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

        return this._operateCurtain([0x57, 0x0f, 0x45, 0x01, 0x05, mode, percent]);
    }

    async _operateCurtain(bytes)
    {
        this.moving = true;
        const blePeripheral = await this.bleAdvertisement.connect();
        await new Promise(resolve => setTimeout(resolve, 1000));
        let req_buf = Buffer.from(bytes);
        try
        {
            await blePeripheral.write('cba20d00224d11e69fb80002a5d5c51b', 'cba20002224d11e69fb80002a5d5c51b', req_buf);
        }
        finally
        {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await blePeripheral.disconnect();
            await new Promise(resolve => setTimeout(resolve, 1000));
            this.moving = false
        }
    }

    async getDeviceValues()
    {
        try
        {
            if (!this.moving)
            {
                const dd = this.getData();

                this.bleAdvertisement = await ManagerBLE.find(dd.id);
                Homey.app.updateLog( Homey.app.varToString( this.bleAdvertisement ));
                let rssi = await this.bleAdvertisement.rssi;
                this.setCapabilityValue('rssi', rssi);

                let data = this._driver.parse(this.bleAdvertisement);
                if (data)
                {
                    Homey.app.updateLog("Parsed BLE: " + Homey.app.varToString( data ));
                    this.setCapabilityValue('windowcoverings_set', data.serviceData.position / 100);
                    this.setCapabilityValue('measure_battery', data.serviceData.battery);
                }
                else
                {
                    Homey.app.updateLog("Parsed BLE: No service data");
                }
            }
            else
            {
                Homey.app.updateLog("Refresh skipped while moving");
            }
        }
        catch (err)
        {
            this.log(err);
        }
    }
}

module.exports = MyDevice;