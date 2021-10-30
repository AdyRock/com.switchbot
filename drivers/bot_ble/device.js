/* jslint node: true */

'use strict';

const Homey = require('homey');
const crc = require('crc-32');

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

        this.setPassord(this.getSetting('password'));

        this.operationMode = false; // Default to push button until we know otherwise
        this.bestRSSI = 100;
        this.bestHub = '';
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
    async onSettings({ Settings, newSettings, changedKeys })
    {
        if (changedKeys.indexOf('password') >= 0)
        {
            this.setPassord(newSettings.password);
        }
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

    setPassord(password)
    {
        if (password === '')
        {
            this.pwArr = [];
        }
        else
        {
            const pwCRC = crc.str(password);
            const pwArrBuff = new ArrayBuffer(4); // an Int32 takes 4 bytes
            const view = new DataView(pwArrBuff);
            view.setUint32(0, pwCRC, false); // byteOffset = 0; bigEndian = false
            this.pwArr = Array.from(new Uint8Array(pwArrBuff));
        }
    }

    // this method is called when the Homey device has requested a position change ( 0 to 1)
    async onCapabilityOnOff(value, opts)
    {
        if (this.operationMode)
        {
            this.homey.app.updateLog(`COMMAND: Setting bot state to:${value}`);

            let cmd = [];
            if (this.pwArr.length > 0)
            {
                cmd = [0x57, 0x11];
                cmd = cmd.concat(this.pwArr);
                if (value)
                {
                    cmd = cmd.concat([0x1]);
                }
                else
                {
                    cmd = cmd.concat([0x02]);
                }
            }
            else
            if (value)
            {
                cmd = [0x57, 0x01, 0x01];
            }
            else
            {
                cmd = [0x57, 0x01, 0x02];
            }
            this._operateBot(cmd);
            return;
        }

        this.homey.app.updateLog('COMMAND: Pressing bot');
        let cmd = [];
        if (this.pwArr.length > 0)
        {
            cmd = [0x57, 0x11];
            cmd = cmd.concat(this.pwArr);
        }
        else
        {
            cmd = [0x57, 0x01, 0x00];
        }

        await this._operateBot(cmd);
        this.homey.setTimeout(() => this.setCapabilityValue('onoff', false).catch(this.error), 1000);
    }

    async _operateBot(bytes)
    {
        const name = this.getName();
        if (this.sendingCommand)
        {
            throw new Error(`Still sending previous command for ${name}`);
        }
        this.sendingCommand = true;

        if (this.homey.app.BLEHub)
        {
            const dd = this.getData();
            if (await this.homey.app.BLEHub.sendBLEHubCommand(dd.address, bytes, this.bestHub))
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
                response = await this._operateBotLoop(name, bytes);
                if (response.status && (response.status === true))
                {
                    this.homey.app.updateLog(`Command complete for ${name}`);
                    this.sendingCommand = false;
                    return;
                }
            }
            catch (err)
            {
                this.homey.app.updateLog(`_operateBot error: ${name} : ${this.homey.app.varToString(err)}`, 0);
            }

            if (loops > 0)
            {
                this.homey.app.updateLog(`Retry command for ${name} in 2 seconds`);
                await this.homey.app.Delay(2000);
            }
        }

        if (response instanceof Error)
        {
            this.homey.app.updateLog(`!!!!!!! Command for ${name} failed\r\n`);
            this.sendingCommand = false;
            throw response;
        }
    }

    async _operateBotLoop(name, bytes, checkPolling = true)
    {
        const returnStatue = { status: false, notificationData: [] };

        let sending = true;

        try
        {
            this.homey.app.updateLog(`Finding BLE device: ${name}`);

            const dd = this.getData();
            const bleAdvertisement = await this.homey.ble.find(dd.id);
            if (!bleAdvertisement)
            {
                this.homey.app.updateLog(`BLE device ${name} not found`);
                return returnStatue;
            }

            this.homey.app.updateLog(`Connecting to BLE device: ${name}`);
            const blePeripheral = await bleAdvertisement.connect();
            this.homey.app.updateLog(`BLE device ${name} connected`);

            const reqBuf = Buffer.from(bytes);
            try
            {
                this.homey.app.updateLog(`Getting service for ${name}`);
                const bleService = await blePeripheral.getService('cba20d00224d11e69fb80002a5d5c51b');

                this.homey.app.updateLog(`Getting write characteristic for ${name}`);
                const bleCharacteristic = await bleService.getCharacteristic('cba20002224d11e69fb80002a5d5c51b');

                if (parseInt(this.homey.version, 10) >= 6)
                {
                    this.homey.app.updateLog(`Getting notify characteristic for ${name}`);
                    const bleNotifyCharacteristic = await bleService.getCharacteristic('cba20003224d11e69fb80002a5d5c51b');

                    bleNotifyCharacteristic.subscribeToNotifications(data =>
                    {
                        sending = false;
                        returnStatue.notificationData = data;
                        this.homey.app.updateLog(`received notification for ${name}: ${this.homey.app.varToString(data)}`);
                    });
                }

                this.homey.app.updateLog(`Writing data to ${name}`);
                await bleCharacteristic.write(reqBuf);
            }
            catch (err)
            {
                this.homey.app.updateLog(`Catch 2: ${name}: ${this.homey.app.varToString(err)}`);
                sending = false;
                return err;
            }
            finally
            {
                this.homey.app.updateLog(`Finally 2: ${name}`);
                let retries = 10;
                while (sending && (retries-- > 0))
                {
                    await this.homey.app.Delay(500);
                }

                await blePeripheral.disconnect();
                this.homey.app.updateLog(`Disconnected: ${name}`);
            }
        }
        catch (err)
        {
            this.homey.app.updateLog(`Catch 1: ${name}: ${this.homey.app.varToString(err)}`, 0);
            return err;
        }
        finally
        {
            this.homey.app.updateLog(`finally 1: ${name}`);
        }

        returnStatue.status = true;
        return returnStatue;
    }

    async getDeviceValues()
    {
        const name = this.getName();
        try
        {
            const dd = this.getData();
            if (this.bestHub !== '')
            {
                // This device is being controlled by a BLE hub
                if (this.homey.app.BLEHub && this.homey.app.BLEHub.IsBLEHubAvailable(this.bestHub))
                {
                    return;
                }

                this.bestHub = '';
            }

            if (dd.id)
            {
                this.homey.app.updateLog(`Finding Bot BLE device ${name}`, 2);

                if (this.pwArr.length > 0)
                {
                    let cmd = [];
                    cmd = [0x57, 0x12];
                    cmd = cmd.concat(this.pwArr);
                    const notification = await this._operateBotLoop(name, cmd, false);

                    if (notification.status === true)
                    {
                        this.setCapabilityValue('measure_battery', notification.notificationData[1]).catch(this.error);
                        this.operationMode = ((notification.notificationData[9] & 16) !== 0);
                    }
                }
                else
                {
                    const bleAdvertisement = await this.homey.ble.find(dd.id);
                    if (!bleAdvertisement)
                    {
                        this.homey.app.updateLog(`BLE device ${name} not found`);
                        return;
                    }

                    this.homey.app.updateLog(this.homey.app.varToString(bleAdvertisement), 3);
                    const rssi = await bleAdvertisement.rssi;
                    this.setCapabilityValue('rssi', rssi).catch(this.error);

                    const data = this.driver.parse(bleAdvertisement);
                    if (data)
                    {
                        this.homey.app.updateLog(`Parsed Bot BLE (${name}) ${this.homey.app.varToString(data)}`, 2);

                        this.setAvailable();
                        this.operationMode = data.serviceData.mode;
                        if (this.operationMode)
                        {
                            this.setCapabilityValue('onoff', data.serviceData.state).catch(this.error);
                        }
                        else
                        {
                            this.setCapabilityValue('onoff', false).catch(this.error);
                        }

                        this.setCapabilityValue('measure_battery', data.serviceData.battery).catch(this.error);

                        this.homey.app.updateLog(`Parsed Bot BLE (${name}): onoff = ${data.serviceData.state}, battery = ${data.serviceData.battery}`, 2);
                    }
                    else
                    {
                        this.homey.app.updateLog(`Parsed Bot BLE (${name}): No service data`, 1);
                    }
                }
            }
            else
            {
                this.setUnavailable(`SwitchBot Bot BLE (${name}) no ID`);
            }
        }
        catch (err)
        {
            this.homey.app.updateLog(this.homey.app.varToString(err), 0);
        }
        finally
        {
            this.homey.app.updateLog(`Finding Bot device (${name}) --- COMPLETE`, 2);
        }
    }

    async syncBLEEvents(events)
    {
        const name = this.getName();
        this.homey.app.updateLog(`syncEvents for (${name})`, 2);
        try
        {
            const dd = this.getData();
            for (const event of events)
            {
                if (event.address && (event.address === dd.address))
                {
                    this.homey.app.updateLog(`Got bot state of: ${event.serviceData.state}`);

                    this.operationMode = event.serviceData.mode;
                    if (this.operationMode)
                    {
                        this.setCapabilityValue('onoff', (event.serviceData.state === 0)).catch(this.error);
                    }
                    else
                    {
                        this.setCapabilityValue('onoff', false).catch(this.error);
                    }

                    this.setCapabilityValue('measure_battery', event.serviceData.battery).catch(this.error);
                    this.setCapabilityValue('rssi', event.rssi).catch(this.error);

                    if (event.hubMAC && ((event.rssi < this.bestRSSI) || (event.hubMAC === this.bestHub)))
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
            this.homey.app.updateLog(`Error in Bot (${name}) syncEvents: ${this.homey.app.varToString(error)}`, 0);
        }
    }

}

module.exports = BotBLEDevice;
