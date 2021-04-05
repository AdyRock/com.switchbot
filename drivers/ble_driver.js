/*jslint node: true */
'use strict';

const Homey = require('homey');

class BLEDriver extends Homey.Driver
{
    /**
     * onInit is called when the driver is initialized.
     */
    async onInit()
    {
        this.getBLEDevices = this.getBLEDevices.bind(this);
    }

    checkExist(devices, device)
    {
        return devices.findIndex(device1 => device1.data.mac === device.data.mac);
    }

    async getBLEDevices(type)
    {
        this.discovering = true;
        try
        {
            let devices = [];

            if (this.homey.app.usingBLEHub)
            {
                let searchData = await this.homey.app.getDevices();
                this.homey.app.detectedDevices = this.homey.app.varToString(searchData);
                this.homey.api.realtime('com.switchbot.detectedDevicesUpdated', { 'devices': this.homey.app.detectedDevices });

                // Create an array of devices
                for (const deviceData of searchData)
                {
                    if (deviceData.serviceData.model === type)
                    {
                        this.homey.app.updateLog("Found device: ");
                        this.homey.app.updateLog(deviceData);

                        let id = deviceData.address.replace(/\:/g, "");

                        let data = { id: id, pid: deviceData.address, address: deviceData.address, model: deviceData.model, modelName: deviceData.modelName };

                        // Add this device to the table
                        devices.push(
                        {
                            "name": deviceData.address,
                            data
                        });
                    }
                }
            }

            let retries = 10;
            while (this.polling && (retries-- > 0))
            {
                await this.asyncDelay(500);
            }

            const bleAdvertisements = await this.homey.ble.discover();
            this.homey.app.detectedDevices = this.homey.app.varToString(bleAdvertisements);
            this.homey.api.realtime('com.switchbot.detectedDevicesUpdated', { 'devices': this.homey.app.detectedDevices });

            for (const bleAdvertisement of bleAdvertisements)
            {
                this.log("ServiceData: ", bleAdvertisement.serviceData);
                let deviceData = this.parse(bleAdvertisement);
                if (deviceData)
                {
                    this.homey.app.updateLog("Parsed BLE: " + JSON.stringify(deviceData, null, 2));
                    if (deviceData.serviceData.model === type)
                    {
                        let device = {
                            "name": bleAdvertisement.address,
                            "data":
                            {
                                id: deviceData.id,
                                pid: deviceData.pid,
                                address: deviceData.address,
                                model: deviceData.model,
                                modelName: deviceData.modelName
                            }
                        };

                        if (this.checkExist(devices, device) < 0)
                        {
                            devices.push(device);
                        }
                    }
                }
            }

            return devices;
        }
        finally
        {
            this.discovering = false;
        }
    }

    /* ------------------------------------------------------------------
     * parse(device)
     * - Parse advertising packets coming from switchbot devices
     *
     * [Arguments]
     * - device | Object  | Required | A `device` object of noble
     *
     * [Return value]
     * - An object as follows:
     *
     * WoHand	
     * {
     *   id: 'c12e453e2008',
     *   address: 'c1:2e:45:3e:20:08',
     *   rssi: -43,
     *   serviceData: {
     *     model: 'H',
     *     modelName: 'WoHand',
     *     mode: false,
     *     state: false,
     *     battery: 95
     *   }
     * }
     *
     * WoSensorTH
     * {
     *   id: 'cb4eb903c96d',
     *   address: 'cb:4e:b9:03:c9:6d',
     *   rssi: -54,
     *   serviceData: {
     *     model: 'T',
     *     modelName: 'WoSensorTH',
     *     temperature: { c: 26.2, f: 79.2 },
     *     fahrenheit: false,
     *     humidity: 45,
     *     battery: 100
     *   }
     * }
     *
     * WoCurtain
     * {
     *   id: 'ec58c5d00111',
     *   address: 'ec:58:c5:d0:01:11',
     *   rssi: -39,
     *   serviceData: {
     *     model: 'c',
     *     modelName: 'WoCurtain',
     *     calibration: true,
     *     battery: 91,
     *     position: 1,
     *     lightLevel: 1
     *   }
     * }
     * 
     * If the specified `device` does not represent any switchbot
     * device, this method will return `null`.
     * ---------------------------------------------------------------- */
    parse(device)
    {
        if (!device)
        {
            return null;
        }
        if (!device.serviceData || device.serviceData.length === 0)
        {
            if (device.localName === "WoHand")
            {
                //looks like a bot device with no service data so make it up
                let data = {
                    id: device.uuid,
                    pid: device.id,
                    address: device.address,
                    rssi: device.rssi,
                    serviceData: {
                        model: 'H',
                        modelName: 'WoHand',
                        mode: false,
                        state: false,
                        battery: 0
                    }
                };
                return data;
        
            }
            return null;
        }
        if (device.serviceData[0].uuid !== '0d00')
        {
            return null;
        }
        let buf = device.serviceData[0].data;
        if (!buf || !Buffer.isBuffer(buf) || buf.length < 3)
        {
            return null;
        }

        let model = buf.slice(0, 1).toString('utf8');
        let sd = null;

        if (model === 'H')
        { // WoHand
            sd = this._parseServiceDataForWoHand(buf);
        }
        else if (model === 'T')
        { // WoSensorTH
            sd = this._parseServiceDataForWoSensorTH(buf);
        }
        else if (model === 'c')
        { // WoCurtain
            sd = this._parseServiceDataForWoCurtain(buf);
        }
        else
        {
            return null;
        }

        if (!sd)
        {
            return null;
        }
        let address = device.address || '';
        if (address === '')
        {
            address = device.advertisement.manufacturerData || '';
            if (address !== '')
            {
                const str = device.advertisement.manufacturerData.toString('hex').slice(4);
                address = str.substr(0, 2);
                for (var i = 2; i < str.length; i += 2)
                {
                    address = address + ":" + str.substr(i, 2);
                }
                // console.log("address", typeof(address), address);
            }
        }
        else
        {
            address = address.replace(/-/g, ':');
        }
        let data = {
            id: device.uuid,
            pid: device.id,
            address: address,
            rssi: device.rssi,
            serviceData: sd
        };
        return data;
    }

    _parseServiceDataForWoHand(buf)
    {
        if (buf.length !== 3)
        {
            return null;
        }
        let byte1 = buf.readUInt8(1);
        let byte2 = buf.readUInt8(2);

        let mode = (byte1 & 0b10000000) != 0 ? true : false; // Whether the light switch Add-on is used or not
        let state = (byte1 & 0b01000000) == 0 ? true : false; // Whether the switch status is ON or OFF
        let battery = byte2 & 0b01111111; // %

        let data = {
            model: 'H',
            modelName: 'WoHand',
            mode: mode,
            state: state,
            battery: battery
        };

        return data;
    }

    _parseServiceDataForWoSensorTH(buf)
    {
        if (buf.length !== 6)
        {
            return null;
        }
        let byte2 = buf.readUInt8(2);
        let byte3 = buf.readUInt8(3);
        let byte4 = buf.readUInt8(4);
        let byte5 = buf.readUInt8(5);

        let temp_sign = (byte4 & 0b10000000) ? 1 : -1;
        let temp_c = temp_sign * ((byte4 & 0b01111111) + (byte3 / 10));
        let temp_f = (temp_c * 9 / 5) + 32;
        temp_f = Math.round(temp_f * 10) / 10;

        let data = {
            model: 'T',
            modelName: 'WoSensorTH',
            temperature:
            {
                c: temp_c,
                f: temp_f
            },
            fahrenheit: (byte5 & 0b10000000) ? true : false,
            humidity: (byte5 & 0b01111111),
            battery: (byte2 & 0b01111111)
        };

        return data;
    }

    _parseServiceDataForWoCurtain(buf)
    {
        if (buf.length !== 5)
        {
            return null;
        }
        let byte1 = buf.readUInt8(1);
        let byte2 = buf.readUInt8(2);
        let byte3 = buf.readUInt8(3);
        let byte4 = buf.readUInt8(4);

        let calibration = byte1 & 0b01000000; // Whether the calibration is completed
        let battery = (byte2 & 0b01111111); // %
        let currPosition = (byte3 & 0b01111111); // current position %
        let lightLevel = (byte4 >> 4) & 0b00001111; // light sensor level (1-10)

        let data = {
            model: 'c',
            modelName: 'WoCurtain',
            calibration: calibration ? true : false,
            battery: battery,
            position: currPosition,
            lightLevel: lightLevel
        };

        return data;
    }
}
module.exports = BLEDriver;