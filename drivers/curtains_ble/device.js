/*jslint node: true */
'use strict';

const Homey = require('homey');

class CurtainsBLEDevice extends Homey.Device
{
    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        this.log('CurtainsBLEDevice has been initialized');

        if (!this.hasCapability("open_close"))
        {
            this.addCapability("open_close");
        }
        if (this.hasCapability("onoff"))
        {
            this.removeCapability("onoff");
        }

        this.bestRSSI = 100;
        this.bestHub = "";

        this._operateCurtain = this._operateCurtain.bind(this);
        this._operateBotLoop = this._operateCurtainsLoop.bind(this);

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

        // register a capability listener
        this.registerCapabilityListener('open_close', this.onCapabilityopenClose.bind(this));
        this.registerCapabilityListener('windowcoverings_set', this.onCapabilityPosition.bind(this));
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded()
    {
        this.log('CurtainsBLEDevice has been added');
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
        if (changedKeys.indexOf("invertPosition") >= 0)
        {
            this.invertPosition = newSettings.invertPosition;
        }

        if (changedKeys.indexOf("motionMode") >= 0)
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
        this.log('CurtainsBLEDevice was renamed');
    }

    /**
     * onDeleted is called when the user deleted the device.
     */
    async onDeleted()
    {
        await this.blePeripheral.disconnect();
        this.log('CurtainsBLEDevice has been deleted');
    }

    // this method is called when the Homey device switches the device on or off
    async onCapabilityopenClose(value, opts)
    {
        value = value ? 1 : 0;
        
        if (this.invertPosition)
        {
            value = 1 - value;
        }

        return await this.runToPos(value * 100, this.motionMode);
    }

    // this method is called when the Homey device has requested a position change ( 0 to 1)
    async onCapabilityPosition(value, opts)
    {
        if (this.invertPosition)
        {
            value = 1 - value;
        }
        return await this.runToPos(value * 100, this.motionMode);
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
     * - mode | number | Optional | the Motion Mode, 0 = Silent, 1 = Performance, 3 = App setting
     *
     * [Return value]
     * - Promise object
     *   Nothing will be passed to the `resolve()`.
     * ---------------------------------------------------------------- */
    async runToPos(percent, mode = 0xff)
    {
        return this._operateCurtain([0x57, 0x0f, 0x45, 0x01, 0x05, mode, percent]);
    }

    async _operateCurtain(bytes)
    {
        if (this.homey.app.usingBLEHub)
        {
            const dd = this.getData();
            if (await this.homey.app.sendBLECommand(dd.address, bytes, this.bestHub))
            {
                return;
            }
        }

        let loops = 5;
        let response = null;
        while (loops-- > 0)
        {
            try
            {
                response = await this._operateCurtainsLoop(bytes);
                if (response === true)
                {
                    this.log("Command complete");
                    return;
                }
            }
            catch (err)
            {
                this.log("_operateBot error: ", err);
            }
            if (loops > 0)
            {
                this.log("Retry command in 5 seconds");
                await this.homey.app.Delay(5000);
            }
        }

        if (response instanceof Error)
        {
            this.log("!!!!!!! Command failed\r\n");
            throw response;
        }
    }

    async _operateCurtainsLoop(bytes)
    {
        if (this.homey.app.moving)
        {
            this.log("Still processing a previous command");
            this.homey.app.updateLog("Still processing a previous command");
            return false;
        }

        while (this.homey.app.polling)
        {
            this.log("Still polling, defering BLE command");
            this.homey.app.updateLog("Still polling, deferring BLE command");
            await this.homey.app.Delay(500);
        }

        let sending = true;

        try
        {
            this.homey.app.moving = true;
            this.homey.app.updateLog("Connecting to BLE device: " + this.getName());

            const dd = this.getData();
            let bleAdvertisement = await this.homey.ble.find(dd.id);
            this.log("Connecting to peripheral");
            const blePeripheral = await bleAdvertisement.connect();
            this.log("Peripheral connected");
            await this.homey.app.Delay(2000);

            let req_buf = Buffer.from(bytes);
            try
            {
                this.log("Discovering characteristics");
                await blePeripheral.discoverAllServicesAndCharacteristics();

                this.log("Getting service");
                const bleService = await blePeripheral.getService('cba20d00224d11e69fb80002a5d5c51b');

                this.log("Getting write characteristic");
                const bleCharacteristic = await bleService.getCharacteristic('cba20002224d11e69fb80002a5d5c51b');
                this.log("Writing data");
                await bleCharacteristic.write(req_buf);
            }
            catch (err)
            {
                this.log("Catch 2: ", err);
                this.homey.app.updateLog("BLE error: " + this.getName() + ": " + this.homey.app.varToString(err));
                sending = false;
                return err;
                //throw(err);
            }
            finally
            {
                this.log("Finally 2");
                this.homey.app.updateLog("Disconnecting from BLE device: " + this.getName());
                let retries = 10;
                while (sending && (retries-- > 0))
                {
                    await this.homey.app.Delay(500);
                }

                await blePeripheral.disconnect();
                this.log("Disconnected");
                this.homey.app.updateLog("Disconnected from BLE device: " + this.getName());
            }
        }
        catch (err)
        {
            this.log("Catch 1", err);
            this.homey.app.updateLog("BLE error: " + this.getName() + ": " + this.homey.app.varToString(err));
            return err;
        }
        finally
        {
            this.log("finally 1");
            this.homey.app.moving = false;
        }

        return true;
    }

    async getDeviceValues()
    {
        try
        {
            const dd = this.getData();
            if (this.bestHub !== "")
            {
                // This device is being controlled by a BLE hub
                if (this.homey.app.IsBLEHubAvailable(this.bestHub))
                {
                    return;
                }

                this.bestHub = "";
            }

            if (dd.id)
            {
                if (!this.homey.app.moving)
                {
                    this.log("Finding Curtain BLE device");
                    let bleAdvertisement = await this.homey.ble.find(dd.id);
                    this.homey.app.updateLog(this.homey.app.varToString(bleAdvertisement));
                    let rssi = await bleAdvertisement.rssi;
                    this.setCapabilityValue('rssi', rssi);

                    let data = this.driver.parse(bleAdvertisement);
                    if (data)
                    {
                        this.homey.app.updateLog("Parsed BLE: " + this.homey.app.varToString(data));
                        let position = data.serviceData.position / 100;
                        if (this.invertPosition)
                        {
                            position = 1 - position;
                        }

                        if (position > 0.5)
                        {
                            this.setCapabilityValue('open_close', true);
                        }
                        else
                        {
                            this.setCapabilityValue('open_close', false);
                        }
    
                        this.setCapabilityValue('windowcoverings_set', position);

                        this.setCapabilityValue('measure_battery', data.serviceData.battery);
                    }
                    else
                    {
                        this.homey.app.updateLog("Parsed BLE: No service data");
                    }
                }
                else
                {
                    this.homey.app.updateLog("Refresh skipped while moving");
                }
            }
            else
            {
                this.setUnavailable("SwitchBot BLE hub not detected");
            }
        }
        catch (err)
        {
            this.log(err);
        }
        finally
        {
            this.log("Finding Bot Curtain device --- COMPLETE");
        }
    }

    async syncBLEEvents(events)
    {
        try
        {
            const dd = this.getData();
            for (const event of events)
            {
                if (event.address && (event.address == dd.address))
                {
                    let position = event.serviceData.position / 100;
                    if (this.invertPosition)
                    {
                        position = 1 - position;
                    }
                    this.setCapabilityValue('windowcoverings_set', position);

                    if (position > 0.5)
                    {
                        this.setCapabilityValue('open_close', true);
                    }
                    else
                    {
                        this.setCapabilityValue('open_close', false);
                    }

                    this.setCapabilityValue('measure_battery', event.serviceData.battery);
                    this.setCapabilityValue('rssi', event.rssi);

                    if (event.hubMAC && (event.rssi < this.bestRSSI) || (event.hubMAC === this.bestHub))
                    {
                        this.bestHub = event.hubMAC;
                        this.bestRSSI = event.rssi;
                    }

                    this.setAvailable();
                }
            }
        }
        catch (error)
        {
            this.homey.app.updateLog("Error in curtains syncEvents: " + error, 0);
        }
    }
}

module.exports = CurtainsBLEDevice;