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
        this._operateBotLoop = this._operateBotLoop.bind(this);

        this.operationMode = false; // Default to push button until we know otherwise
        this.bestRSSI = 100;
        this.bestHub = "";
        this.sendingCommand = false;

        // register a capability listener
        this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded()
    {
        this.log('BotBLEDevice has been added');
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
            this.homey.app.updateLog("COMMAND: Setting bot state to:" + value);
            if (value)
            {
                return await this._operateBot([0x57, 0x01, 0x01]);
            }

            return await this._operateBot([0x57, 0x01, 0x02]);
        }
        else
        {
            this.homey.app.updateLog("COMMAND: Pressing bot");
            await this._operateBot([0x57, 0x01, 0x00]);
            setTimeout(() => this.setCapabilityValue('onoff', false), 1000);
        }
    }

    async _operateBot(bytes)
    {
        if (this.sendingCommand)
        {
            throw new Error("Still sending previous command");
        }
        this.sendingCommand = true;

        if (this.homey.app.usingBLEHub)
        {
            const dd = this.getData();
            if (await this.homey.app.sendBLECommand(dd.address, bytes, this.bestHub))
            {
                this.sendingCommand = false;
                return;
            }
        }

        let loops = 5;
        let response = null;
        while (loops-- > 0)
        {
            try
            {
                response = await this._operateBotLoop(bytes);
                if (response === true)
                {
                    this.homey.app.updateLog("Command complete");
                    this.sendingCommand = false;
                    return;
                }
            }
            catch (err)
            {
                this.homey.app.updateLog("_operateBot error: " + this.homey.app.varToString(err), 0);
            }
            if (loops > 0)
            {
                this.homey.app.updateLog("Retry command in 2 seconds");
                await this.homey.app.Delay(2000);
            }
        }

        if (response instanceof Error)
        {
            this.homey.app.updateLog("!!!!!!! Command failed\r\n");
            this.sendingCommand = false;
            throw response;
        }
    }

    async _operateBotLoop(bytes)
    {
        while (this.homey.app.polling /*|| this.homey.app.moving*/ )
        {
            this.homey.app.updateLog("Busy, deferring BLE command");
            await this.homey.app.Delay(500);
        }

        this.homey.app.moving++;
        let delay = this.homey.app.moving * 1000;
        let sending = true;

        try
        {
            this.homey.app.updateLog("Connecting to BLE device: " + this.getName());

            const dd = this.getData();
            let bleAdvertisement = await this.homey.ble.find(dd.id);
            this.homey.app.updateLog("Connecting to peripheral");
            const blePeripheral = await bleAdvertisement.connect();
            this.homey.app.updateLog("Peripheral connected");
            await this.homey.app.Delay(delay);

            let req_buf = Buffer.from(bytes);
            try
            {
                this.homey.app.updateLog("Getting service");
                const bleService = await blePeripheral.getService('cba20d00224d11e69fb80002a5d5c51b');

                this.homey.app.updateLog("Getting write characteristic");
                const bleCharacteristic = await bleService.getCharacteristic('cba20002224d11e69fb80002a5d5c51b');

                if (parseInt(this.homey.version) >= 6)
                {
                    this.homey.app.updateLog("Getting notify characteristic");
                    const bleNotifyCharacteristic = await bleService.getCharacteristic('cba20003224d11e69fb80002a5d5c51b');

                    bleNotifyCharacteristic.subscribeToNotifications(data =>
                    {
                        sending = false;
                        this.homey.app.updateLog('received notification:' + this.homey.app.varToString(data));
                    });
                }

                this.homey.app.updateLog("Writing data");
                await bleCharacteristic.write(req_buf);
            }
            catch (err)
            {
                this.homey.app.updateLog("Catch 2: " + this.getName() + ": " + this.homey.app.varToString(err), 0);
                sending = false;
                return err;
                //throw(err);
            }
            finally
            {
                this.homey.app.updateLog("Finally 2: " + this.getName());
                let retries = 10;
                while (sending && (retries-- > 0))
                {
                    await this.homey.app.Delay(500);
                }

                await blePeripheral.disconnect();
                this.homey.app.updateLog("Disconnected: " + this.getName());
            }
        }
        catch (err)
        {
            this.homey.app.updateLog("Catch 1: " + this.getName() + ": " + this.homey.app.varToString(err), 0);
            return err;
        }
        finally
        {
            this.homey.app.updateLog("finally 1");
            this.homey.app.moving--;
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
                if (this.homey.app.moving === 0)
                {
                    this.homey.app.updateLog("Finding Bot BLE device", 2);
                    let bleAdvertisement = await this.homey.ble.find(dd.id);
                    this.homey.app.updateLog(this.homey.app.varToString(bleAdvertisement), 3);
                    let rssi = await bleAdvertisement.rssi;
                    this.setCapabilityValue('rssi', rssi);

                    let data = this.driver.parse(bleAdvertisement);
                    if (data)
                    {
                        this.homey.app.updateLog("Parsed Bot BLE: " + this.homey.app.varToString(data), 2);

                        this.setAvailable();
                        this.operationMode = data.serviceData.mode;
                        if (this.operationMode)
                        {
                            this.setCapabilityValue('onoff', data.serviceData.state);
                        }
                        else
                        {
                            this.setCapabilityValue('onoff', false);
                        }

                        this.setCapabilityValue('measure_battery', data.serviceData.battery);

                        this.homey.app.updateLog(`Parsed Bot BLE: onoff = ${data.serviceData.state}, battery = ${data.serviceData.battery}`, 2);
                    }
                    else
                    {
                        this.homey.app.updateLog("Parsed Bot BLE: No service data", 0);
                    }
                }
                else
                {
                    this.homey.app.updateLog("Bot Refresh skipped while moving");
                }
            }
            else
            {
                this.setUnavailable("SwitchBot BLE hub not detected", 0);
            }
        }
        catch (err)
        {
            this.homey.app.updateLog(this.homey.app.varToString(err), 0);
        }
        finally
        {
            this.homey.app.updateLog("Finding Bot BLE device --- COMPLETE", 2);
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
                    this.homey.app.updateLog("Got bot state of: " + event.serviceData.state);

                    this.operationMode = event.serviceData.mode;
                    if (this.operationMode)
                    {
                        this.setCapabilityValue('onoff', (event.serviceData.state === 0));
                    }
                    else
                    {
                        this.setCapabilityValue('onoff', false);
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
            this.homey.app.updateLog("Error in bot syncEvents: " + error, 0);
        }
    }
}

module.exports = BotBLEDevice;