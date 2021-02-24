/*jslint node: true */
'use strict';

const Homey = require('homey');

class BotBLEDevice extends Homey.Device
{
    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        this.log('BotBLEDevice has been initialized');

        this._operateBot = this._operateBot.bind(this);

        this.operationMode = false; // Default to push button until we know otherwise
        this.bestRSSI = 100;
        this.bestHub = "";

        try
        {
            this.getDeviceValues();
        }
        catch (err)
        {
            this.log(err);
        }

        // register a capability listener
        this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded()
    {
        this.log('BotBLEDevice has been added');
        try
        {
            this.getDeviceValues();
        }
        catch (err)
        {
            this.log(err);
        }
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
        this.log('BotBLEDevice settings where changed');
    }

    /**
     * onRenamed is called when the user updates the device's name.
     * This method can be used this to synchronise the name to the device.
     * @param {string} name The new name
     */
    async onRenamed(name)
    {
        this.log('BotBLEDevice was renamed');
    }

    /**
     * onDeleted is called when the user deleted the device.
     */
    async onDeleted()
    {
        await this.blePeripheral.disconnect();
        this.log('BotBLEDevice has been deleted');
    }

    // this method is called when the Homey device has requested a position change ( 0 to 1)
    async onCapabilityOnOff(value, opts)
    {
        if (this.operationMode)
        {
            console.log("Set bot state to:", value);
            if (value)
            {
                return await this._operateBot([0x57, 0x01, 0x01]);
            }

            return await this._operateBot([0x57, 0x01, 0x02]);
        }
        else
        {
            console.log("Press bot");
            await this._operateBot([0x57, 0x01, 0x00]);
            setTimeout(() => this.setCapabilityValue('onoff', false), 1000);
        }
    }

    async _operateBot(bytes)
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
            response = await this._operateBotLoop(bytes);
            if (response === true)
            {
                return;
            }

            await this.homey.app.Delay(5000);
        }

        if (response instanceof Error)
        {
            throw response;
        }
    }

    async _operateBotLoop(bytes)
    {
        if (this.moving)
        {
            this.homey.app.updateLog("Still processing the previous command to: " + this.getName());
            return false;
        }

        if (this.updating)
        {
            this.deferCommandTimerID = setTimeout(this._operateBot, 500);
        }
        try
        {
            this.moving = true;
            this.homey.app.updateLog("Connecting to BLE device: " + this.getName());

            const dd = this.getData();
            let bleAdvertisement = await this.homey.ble.find(dd.id);
            const blePeripheral = await bleAdvertisement.connect();
            await this.homey.app.Delay(1000);

            let req_buf = Buffer.from(bytes);
            try
            {
                this.homey.app.updateLog("Getting BLE service for " + this.getName());
                const bleServices = await blePeripheral.discoverServices(['cba20d00224d11e69fb80002a5d5c51b']);

                this.homey.app.updateLog("Getting BLE characteristic for " + this.getName());
                const bleCharacteristics = await bleServices[0].discoverCharacteristics(['cba20002224d11e69fb80002a5d5c51b']);

                this.homey.app.updateLog("Sending command via BLE to: " + this.getName() + ":       " + bytes);

                await bleCharacteristics[0].write(req_buf);

                this.homey.app.updateLog("Sent command via BLE to: " + this.getName());
            }
            catch (err)
            {
                this.homey.app.updateLog("BLE error: " + this.getName() + ": " + this.homey.app.varToString(err));
                return err;
                //throw(err);
            }
            finally
            {
                this.homey.app.updateLog("Disconnecting from BLE device: " + this.getName());
                await this.homey.app.Delay(1000);

                await blePeripheral.disconnect();

                this.homey.app.updateLog("Disconnected from BLE device: " + this.getName());
            }
        }
        finally
        {
            this.moving = false;
        }

        return true;
    }

    async getDeviceValues()
    {
        try
        {
            const dd = this.getData();
            if (this.homey.app.usingBLEHub)
            {
                let data = await this.homey.app.getDevice(dd.address);
                if (data)
                {
                    this.setAvailable();
                    console.log("Got bot state of:", data.serviceData.state);

                    this.operationMode = data.serviceData.mode;

                    this.homey.app.updateLog("Parsed BLE: " + this.homey.app.varToString(data));
                    this.setCapabilityValue('onoff', (data.serviceData.state === 0));
                    this.setCapabilityValue('measure_battery', data.serviceData.battery);
                    this.setCapabilityValue('rssi', data.rssi);

                    if (data.hubMAC && (data.rssi < this.bestRSSI) || (data.hubMAC === this.bestHub))
                    {
                        this.bestHub = data.hubMAC;
                        this.bestRSSI = data.rssi;
                    }
                }
                else
                {
                    this.homey.app.updateLog("Parsed BLE: No service data");
                }

                return;
            }

            if (dd.id)
            {
                if (!this.moving && !this.updating)
                {
                    this.updating = true;

                    let bleAdvertisement = await this.homey.ble.find(dd.id);
                    this.homey.app.updateLog(this.homey.app.varToString(bleAdvertisement));
                    let rssi = await bleAdvertisement.rssi;
                    this.setCapabilityValue('rssi', rssi);

                    let data = this.driver.parse(bleAdvertisement);
                    if (data)
                    {
                        this.homey.app.updateLog("Parsed BLE: " + this.homey.app.varToString(data));
                        this.setCapabilityValue('onoff', (data.serviceData.state === 0));
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
            this.updating = false;
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
                    console.log("Got bot state of:", event.serviceData.state);

                    this.operationMode = event.serviceData.mode;

                    this.setCapabilityValue('onoff', (event.serviceData.state === 0));
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
            this.homey.app.updateLog("Error in bot syncEvents: " + error, 0);
        }
    }
}

module.exports = BotBLEDevice;