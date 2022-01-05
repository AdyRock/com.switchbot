/* jslint node: true */

'use strict';

const Homey = require('homey');

class ColorBulbBLEDevice extends Homey.Device
{

    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        this.bestRSSI = 100;
        this.bestHub = '';
        this.lastSequence = null;

        this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
        this.registerCapabilityListener('dim', this.onCapabilityDim.bind(this));
        this.registerCapabilityListener('light_mode', this.onCapabilityLightMode.bind(this));
        this.registerCapabilityListener('light_temperature', this.onCapabilityLightTemperature.bind(this));
        this.registerMultipleCapabilityListener(['light_hue', 'light_saturation'], this.onCapabilityLightHueSat.bind(this), 500);

        this.homey.app.registerBLEPolling();

        this.log('ColorBulbBLEDevice has been initialized');
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded()
    {
        this.log('ColorBulbBLEDevice has been added');
    }

    /**
     * onDeleted is called when the user deleted the device.
     */
    async onDeleted()
    {
        this.homey.app.unregisterBLEPolling();
        await this.blePeripheral.disconnect();
        this.log('ColorBulbBLEDevice has been deleted');
    }

    // this method is called when the Homey device switches the device on or off
    async onCapabilityOnOff(value, opts)
    {
        value = value ? 0x03 : 0x02;
        this._operateBulb([0x57, 0x0f, 0x47, 0x01, value]);
    }

    async onCapabilityLightMode(value, opts)
    {
        // No need to do anything
    }

    async onCapabilityDim(value, opts)
    {
        this._operateBulb([0x57, 0x0f, 0x47, 0x01, 0x14, value * 100]);
    }

    async onCapabilityLightTemperature(value, opts)
    {
        // {2700-6500}
        const temperature = ((1 - value) * (6500 - 2700)) + 2700;
        this._operateBulb([0x57, 0x0f, 0x47, 0x01, 0x17, ((temperature / 256) & 0xFF), (temperature & 0xFF)]);
    }

    async onCapabilityLightHueSat(capabilityValues, capabilityOptions)
    {
        // Convert Hue, Saturation, Dim to RGB
        const dim = 0.5;
        const rgb = this.hslToRgb(capabilityValues.light_hue, capabilityValues.light_saturation, dim);

        this._operateBulb([0x57, 0x0f, 0x47, 0x01, 0x16, rgb[0], rgb[1], rgb[2]]);
    }

    hslToRgb(h, s, l)
    {
        h *= 360;
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = l - c / 2;
        let r = 0;
        let g = 0;
        let b = 0;

        if (h >= 0 && h < 60)
        {
            r = c;
            g = x;
            b = 0;
        }
        else if (h >= 60 && h < 120)
        {
            r = x;
            g = c;
            b = 0;
        }
        else if (h >= 120 && h < 180)
        {
            r = 0;
            g = c;
            b = x;
        }
        else if (h >= 180 && h < 240)
        {
            r = 0;
            g = x;
            b = c;
        }
        else if (h >= 240 && h < 300)
        {
            r = x;
            g = 0;
            b = c;
        }
        else if (h >= 300 && h < 360)
        {
            r = c;
            g = 0;
            b = x;
        }
        r = Math.round((r + m) * 255);
        g = Math.round((g + m) * 255);
        b = Math.round((b + m) * 255);

        return [r, g, b];
    }

    rgbToHsl(r, g, b)
    {
        // Make r, g, and b fractions of 1
        r /= 255;
        g /= 255;
        b /= 255;

        // Find greatest and smallest channel values
        const cMin = Math.min(r, g, b);
        const cMax = Math.max(r, g, b);
        const delta = cMax - cMin;
        let h = 0;
        let s = 0;
        let l = 0;
        // Calculate hue
        // No difference
        if (delta === 0)
        {
            h = 0;
        }
        // Red is max
        else if (cMax === r)
        {
            h = ((g - b) / delta) % 6;
        }
        // Green is max
        else if (cMax === g)
        {
            h = (b - r) / delta + 2;
        }
        // Blue is max
        else
        {
            h = (r - g) / delta + 4;
        }

        h = Math.round(h * 60);

        // Make negative hues positive behind 360°
        if (h < 0)
        {
            h += 360;
        }

        // Calculate lightness
        l = (cMax + cMin) / 2;

        // Calculate saturation
        s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

        // Multiply l and s by 100
        s = +(s * 100).toFixed(1);
        l = +(l * 100).toFixed(1);

        return [h, s, l];
    }

    async _operateBulb(bytes)
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
                response = await this._operateBulbLoop(name, bytes);
                if (response === true)
                {
                    this.homey.app.updateLog(`Command complete for ${name}`);
                    this.sendingCommand = false;
                    return;
                }
            }
            catch (err)
            {
                this.homey.app.updateLog(`_operateBulb error: ${name} : ${this.homey.app.varToString(err)}`, 0);
            }
            if (loops > 0)
            {
                this.homey.app.updateLog(`Retry command for ${name} in 2 seconds`);
                await this.homey.app.Delay(2000);
            }
        }

        this.sendingCommand = false;

        if (response instanceof Error)
        {
            this.homey.app.updateLog(`!!!!!!! Command for ${name} failed\r\n`);
            throw response;
        }
    }

    async _operateBulbLoop(name, bytes)
    {
        let sending = true;

        try
        {
            this.homey.app.updateLog(`Looking for BLE device: ${name}`);

            const dd = this.getData();
            const bleAdvertisement = await this.homey.ble.find(dd.id);
            if (!bleAdvertisement)
            {
                this.homey.app.updateLog(`BLE device ${name} not found`);
                return false;
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

                if (!this.homey.version || parseInt(this.homey.version, 10) >= 6)
                {
                    this.homey.app.updateLog(`Getting notify characteristic for ${name}`);
                    const bleNotifyCharacteristic = await bleService.getCharacteristic('cba20003224d11e69fb80002a5d5c51b');

                    bleNotifyCharacteristic.subscribeToNotifications(data =>
                    {
                        if ((data.length === 11) && (data[0] === 1))
                        {
                            setImmediate(() =>
                            {
                                this.updateFromNotify(data);
                            });
                        }
                        sending = false;
                        this.homey.app.updateLog(`received notification for ${name}: ${this.homey.app.varToString(data)}`);
                    });
                }

                this.homey.app.updateLog(`Getting notify characteristic for ${name}`);
                const bleNotifyCharacteristic = await bleService.getCharacteristic('cba20003224d11e69fb80002a5d5c51b');

                bleNotifyCharacteristic.subscribeToNotifications(data =>
                {
                    if ((data.length === 11) && (data[0] === 1))
                    {
                        setImmediate(() =>
                        {
                            this.updateFromNotify(data);
                        });
                    }
                    sending = false;
                    this.homey.app.updateLog(`received notification for ${name}: ${this.homey.app.varToString(data)}`);
                });

                this.homey.app.updateLog(`Writing ${bytes.toString('hex')} to ${name}`);
                await bleCharacteristic.write(reqBuf);
            }
            catch (err)
            {
                this.homey.app.updateLog(`Catch 2: ${name}: ${this.homey.app.varToString(err)}`);
                sending = false;
                return err;
                // throw(err);
            }
            finally
            {
                this.homey.app.updateLog(`Finally 2: ${name}`);
                let retries = 6;
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
            this.homey.app.updateLog(`Catch 1: ${name}: ${this.homey.app.varToString(err)}`);
            return err;
        }
        finally
        {
            this.homey.app.updateLog(`finally 1: ${name}`);
        }

        return true;
    }

    updateFromNotify(data)
    {
        this.setCapabilityValue('onoff', ((data[1] & 0x80) === 0x80)).catch(this.error);
        this.setCapabilityValue('dim', data[2] / 100).catch(this.error);
        if (data[10] === 1)
        {
            // White mode
            this.setCapabilityValue('light_mode', 'temperature').catch(this.error);
            const temperature = data[7] + data[6] * 256;
            this.setCapabilityValue('light_temperature', 1 - (temperature - 2700) / (6500 - 2700)).catch(this.error);
        }
        else if (data[10] === 2)
        {
            // Colour mode
            this.setCapabilityValue('light_mode', 'color').catch(this.error);
            const hsl = this.rgbToHsl(data[3], data[4], data[5]);
            this.setCapabilityValue('light_hue', hsl[0] / 360).catch(this.error);
            this.setCapabilityValue('light_saturation', hsl[1] / 100).catch(this.error);
        }
        else
        {
            // Dynamic mode
        }
    }

    async getDeviceValues()
    {
        if (this.sendingCommand)
        {
            return;
        }

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
                this.homey.app.updateLog(`Finding Bulb BLE device ${name}`, 2);
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
                    if (data.serviceData.on_off)
                    {
                        this.setCapabilityValue('onoff', true).catch(this.error);
                        this.setCapabilityValue('dim', data.serviceData.dim / 100).catch(this.error);
                        if (this.lastSequence !== data.serviceData.sequence)
                        {
                            // Read the data to get the rgb / temperature values
                            this.lastSequence = data.serviceData.sequence;
                            this._operateBulb([0x57, 0x0f, 0x48, 0x01]);
                        }
                    }
                    else
                    {
                        this.setCapabilityValue('onoff', false).catch(this.error);
                    }
                    this.homey.app.updateLog(`Parsed Bulb BLE (${name}) ${this.homey.app.varToString(data)}`, 2);
                }
                else
                {
                    this.homey.app.updateLog(`Parsed Bulb BLE (${name}): No service data`, 1);
                }
            }
            else
            {
                this.setUnavailable(`SwitchBot Bulb BLE (${name}) no ID`);
            }
        }
        catch (err)
        {
            this.homey.app.updateLog(this.homey.app.varToString(err), 0);
        }
        finally
        {
            this.homey.app.updateLog(`Finding Bulb device (${name}) --- COMPLETE`, 2);
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
                if (event.address && (event.address === dd.address) && (event.serviceData.modelName === 'WoBulb'))
                {
                    if (event.replyData)
                    {
                        this.updateFromNotify(event.replyData);
                    }
                    else
                    {
                        if (event.hubMAC && ((event.rssi < this.bestRSSI) || (event.hubMAC === this.bestHub)))
                        {
                            this.bestHub = event.hubMAC;
                            this.bestRSSI = event.rssi;
                        }

                        if (event.serviceData.on_off)
                        {
                            this.setCapabilityValue('onoff', true).catch(this.error);
                            this.setCapabilityValue('dim', event.serviceData.dim / 100).catch(this.error);
                            if (this.lastSequence !== event.serviceData.sequence)
                            {
                                // Read the data to get the rgb / temperature values
                                this.lastSequence = event.serviceData.sequence;
                                this._operateBulb([0x57, 0x0f, 0x48, 0x01]);
                            }
                        }
                        else
                        {
                            this.setCapabilityValue('onoff', false).catch(this.error);
                        }

                        this.setAvailable();
                    }
                }
            }
        }
        catch (error)
        {
            this.homey.app.updateLog(`Error in Bulb (${name}) syncEvents: ${this.homey.app.varToString(error)}`, 0);
        }
    }

}

module.exports = ColorBulbBLEDevice;
