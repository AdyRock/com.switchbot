/*jslint node: true */
'use strict';
if (process.env.DEBUG === '1')
{
    require('inspector').open(9222, '0.0.0.0', true);
}

const Homey = require('homey');
const http = require("http");
const dgram = require('dgram');

const MINIMUM_POLL_INTERVAL = 5;
const BLE_POLLING_INTERVAL = 10000;
class MyApp extends Homey.App
{
    /**
     * onInit is called when the app is initialized.
     */
    async onInit()
    {
        this.log('SwitchBot has been initialized');
        this.diagLog = "";
        this.moving = false;
        this.discovering = false;

        if (process.env.DEBUG === '1')
        {
            this.homey.settings.set('debugMode', true);
        }
        else
        {
            this.homey.settings.set('debugMode', false);
        }

        this.BearerToken = this.homey.settings.get('BearerToken');

        if (this.homey.settings.get('pollInterval') < MINIMUM_POLL_INTERVAL)
        {
            this.homey.settings.set('pollInterval', MINIMUM_POLL_INTERVAL);
        }

        this.log("SwitchBot has started with Key: " + this.BearerToken + " Polling every " + this.homey.settings.get('pollInterval') + " seconds");

        // Callback for app settings changed
        this.homey.settings.on('set', async function(setting)
        {
            this.homey.app.updateLog("Setting " + setting + " has changed.");

            if (setting === 'BearerToken')
            {
                this.homey.app.BearerToken = this.homey.settings.get('BearerToken');
            }

            if (setting === 'pollInterval') {}
        });

        // Set to true to enable use of my BLE hub (WIP)
        this.enableBLEHub = true;
        this.usingBLEHub = false;

        this.BLEHubs = [];

        this.homeyId = await this.homey.cloud.getLocalAddress();

        this.onHubPoll = this.onHubPoll.bind(this);
        this.timerHubID = setTimeout(this.onHubPoll, 10000);

        this.onBLEPoll = this.onBLEPoll.bind(this);
        this.timerID = setTimeout(this.onBLEPoll, BLE_POLLING_INTERVAL);

        const server = dgram.createSocket('udp4');
        server.on('error', (err) =>
        {
            console.log(`server error:\n${err.stack}`);
            server.close();
        });

        server.on('message', (msg, rinfo) =>
        {
            console.log(`server got: ${msg} from ${rinfo.address}:${rinfo.port}`);
            if (this.enableBLEHub)
            {
                let msgTxt = msg.toString();
                if (msgTxt.indexOf('SwitchBot BLE Hub!') == 0)
                {
                    let newAddress = false;

                    let mac = msgTxt.substring(19, 36);
                    let hubEntry = this.BLEHubs.find(entry => entry.mac === mac);
                    if (!hubEntry)
                    {
                        this.BLEHubs.push({ 'mac': mac, 'address': rinfo.address });
                        newAddress = true;
                    }
                    else
                    {
                        hubEntry.address = rinfo.address;
                    }

                    this.usingBLEHub = true;

                    setImmediate(() => { this.refreshBLEHubCallback(rinfo.address, newAddress); });
                }
            }
        });

        server.on('listening', () =>
        {
            var address = server.address();
            console.log(`server listening ${address.address}:${address.port}`);
        });

        server.bind(1234, () =>
        {
            server.addMembership('239.1.2.3');
            setTimeout(() => { server.send("Are you there SwitchBot?", 1234, '239.1.2.3'); }, 500);
        });

        this.updateLog('************** App has initialised. ***************');
    }

    varToString(source)
    {
        try
        {
            if (source === null)
            {
                return "null";
            }
            if (source === undefined)
            {
                return "undefined";
            }
            if (source instanceof Error)
            {
                let stack = source.stack.replace('/\\n/g', '\n');
                return source.message + '\n' + stack;
            }
            if (typeof(source) === "object")
            {
                const getCircularReplacer = () =>
                {
                    const seen = new WeakSet();
                    return (key, value) =>
                    {
                        if (typeof value === "object" && value !== null)
                        {
                            if (seen.has(value))
                            {
                                return;
                            }
                            seen.add(value);
                        }
                        return value;
                    };
                };

                return JSON.stringify(source, getCircularReplacer(), 2);
            }
            if (typeof(source) === "string")
            {
                return source;
            }
        }
        catch (err)
        {
            this.log("VarToString Error: ", err);
        }

        return source.toString();
    }

    updateLog(newMessage, errorLevel = 1)
    {
        if ((errorLevel == 0) || this.homey.settings.get('logEnabled'))
        {
            console.log(newMessage);
            this.diagLog += "* ";
            this.diagLog += newMessage;
            this.diagLog += "\r\n";
            if (this.diagLog.length > 60000)
            {
                this.diagLog = this.diagLog.substr(this.diagLog.length - 60000);
            }
            this.homey.api.realtime('com.switchbot.logupdated', { 'log': this.diagLog });
        }
    }

    //=======================================================================================
    //BLEHub interface

    async getDevices()
    {
        try
        {
            const url = "devices";
            let data = await this.GetBLEHubsURL(url);
            // merge into one array
            data = data.flat();
            // Remove duplicate entries
            data = data.filter((v, i, a) => a.findIndex(t => (t.address === v.address)) === i);
            return data;
        }
        catch (err)
        {
            this.homey.app.updateLog(err, 0);
        }

        return null;
    }

    async getDevice(Address)
    {
        try
        {
            const url = "device?address=" + Address;
            let data = await this.GetBLEHubsURL(url);
            if (!data || data.length === 0)
            {
                return null;
            }

            // Get object with best rssi value
            data = data.reduce((max, device) => max.rssi > device.rssi ? max : device);
            return data;
        }
        catch (err)
        {
            this.homey.app.updateLog(err, 0);
        }

        return null;
    }

    async sendBLECommand(address, command, bestHub)
    {
        try
        {
            const url = "device/write";
            this.homey.app.updateLog("Request to write: " + command + " to " + address);
            const body = { "address": address, data: command };
            let response = await this.PostBLEHubsURL(url, body, bestHub, true);
            if (response)
            {
                for (var i = 0; i < response.length; i++)
                {
                    if (response[i].statusCode === 200)
                    {
                        return true;
                    }
                }

                this.homey.app.updateLog("Invalid response code: " + response[0].statusCode + ":  " + response[0].message, 0);
                return false;
            }

            this.homey.app.updateLog("Invalid response: No data", 0);
        }
        catch (err)
        {
            this.homey.app.updateLog(err, 0);
        }

        return false;
    }

    async refreshBLEHubCallback(Address, isNewAddress)
    {
        try
        {
            const url = "callback/add";
            const callbackUrl = "http://" + this.homeyId + "/api/app/com.switchbot/newData/";
            this.homey.app.updateLog("Registering callback: " + callbackUrl);
            const body = { "uri": callbackUrl };
            let response = await this.PostBLEHubURL(url, body, Address);
            if (response)
            {
                if (response.statusCode !== 200)
                {
                    this.homey.app.updateLog("Invalid response code: " + response.statusCode + ":  " + response.message, 0);
                    return false;
                }

                if (isNewAddress)
                {
                    this.refreshBLEDevices();
                }

                return true;
            }

            this.homey.app.updateLog("Invalid response: No data", 0);
        }
        catch (err)
        {
            this.homey.app.updateLog(err, 0);
        }

        return false;
    }

    async GetBLEHubsURL(path)
    {
        let responses = [];

        for (var i = 0; i < this.BLEHubs.length; i++)
        {
            try
            {
                responses.push(await this.GetBLEHubURL(path, this.BLEHubs[i].address));
            }
            catch (err)
            {
                this.BLEHubs.splice(i, 1);
                if (this.BLEHubs.length === 0)
                {
                    this.usingBLEHub = false;
                }

                console.log(err);
            }
        }
        return responses;
    }

    async GetBLEHubURL(path, HubAddress)
    {
        // Send a request to the specified 
        this.homey.app.updateLog("Get from: " + HubAddress + " " + path);

        return new Promise((resolve, reject) =>
        {
            try
            {
                let http_options = {
                    host: HubAddress,
                    path: "/api/v1/" + path,
                    timeout: 15000
                };

                let req = http.get(http_options, (res) =>
                {
                    if (res.statusCode === 200)
                    {
                        let body = [];
                        res.on('data', (chunk) =>
                        {
                            body.push(chunk);
                        });
                        res.on('end', () =>
                        {
                            try
                            {
                                let returnData = JSON.parse(Buffer.concat(body));
                                this.homey.app.updateLog("Get response: " + this.homey.app.varToString(returnData));
                                resolve(returnData);
                            }
                            catch (err)
                            {
                                reject(new Error("HTTP Error: " + err.message));
                                return;
                            }
                        });
                    }
                    else
                    {
                        let message = "";
                        if (res.statusCode === 204)
                        {
                            message = "No Data Found";
                        }
                        else if (res.statusCode === 400)
                        {
                            message = "Bad request";
                        }
                        else if (res.statusCode === 401)
                        {
                            message = "Unauthorized";
                        }
                        else if (res.statusCode === 403)
                        {
                            message = "Forbidden";
                        }
                        else if (res.statusCode === 404)
                        {
                            message = "Not Found";
                        }
                        this.homey.app.updateLog("HTTPS Error: " + res.statusCode + ": " + message, 0);
                        reject(new Error("HTTP Error: " + message));
                        return;
                    }
                }).on('error', (err) =>
                {
                    this.homey.app.updateLog(err, 0);
                    reject(new Error("HTTP Catch: " + err));
                    return;
                });

                req.setTimeout(15000, function()
                {
                    req.destroy();
                    reject(new Error("HTTP Catch: Timeout"));
                    return;
                });
            }
            catch (err)
            {
                this.homey.app.updateLog(err, 0);
                reject(new Error("HTTP Catch: " + err));
                return;
            }
        });
    }

    IsBLEHubAvailable( hubMAC)
    {
        return (this.BLEHubs.findIndex(hub => hub.mac === hubMAC) >= 0);
    }

    async PostBLEHubsURL(path, body, bestHub, JustOneGoodOne = false)
    {
        let responses = [];

        if (bestHub)
        {
            // This one first
            let x = this.BLEHubs.findIndex(hub => hub.mac === bestHub);
            if (x >= 0)
            {
                try
                {
                    let response = await this.PostBLEHubURL(path, body, this.BLEHubs[x].address);
                    if (response.statusCode === 200)
                    {
                        responses.push(response);
                        return responses;
                    }
                }
                catch (err)
                {
                    this.BLEHubs.splice(x, 1);
                    if (this.BLEHubs.length === 0)
                    {
                        this.usingBLEHub = false;
                    }
                    console.log(err);
                }
            }
        }

        for (var i = 0; i < this.BLEHubs.length; i++)
        {
            try
            {
                let response = await this.PostBLEHubURL(path, body, this.BLEHubs[i].address);
                responses.push(response);
                if (JustOneGoodOne && (response.statusCode === 200))
                {
                    break;
                }
            }
            catch (err)
            {
                this.BLEHubs.splice(i, 1);
                i--;
                if (this.BLEHubs.length === 0)
                {
                    this.usingBLEHub = false;
                }
                console.log(err);
            }
        }

        if (responses.length == 0)
        {
            responses.push({ statusCode: 410, message: "No hubs" });
        }
        return responses;
    }

    async Delay(period)
    {
        await new Promise(resolve => setTimeout(resolve, period));
    }

    async PostBLEHubURL(url, body, HubAddress)
    {
        this.homey.app.updateLog(url);
        let bodyText = JSON.stringify(body);
        this.homey.app.updateLog(bodyText);

        let retries = 10;
        while (this.postInProgress && (retries-- > 0))
        {
            await this.Delay(100);
        }
        if (this.postInProgress)
        {
            console.log("\n*** POST IN PROGRESS ***\n\n");
            //throw (new Error({ "message": "Busy", "statusCode": 300 }));
        }

        return new Promise((resolve, reject) =>
        {
            this.postInProgress = true;

            try
            {
                let http_options = {
                    host: HubAddress,
                    path: "/api/v1/" + url,
                    method: "POST",
                    headers:
                    {
                        "contentType": "application/json; charset=utf-8",
                        "Content-Length": bodyText.length,
                        "connection": 'Close'
                    },
                };

                this.homey.app.updateLog(http_options);

                let req = http.request(http_options, (res) =>
                {
                    let body = [];
                    res.on('data', (chunk) =>
                    {
                        this.homey.app.updateLog("Post: retrieve data");
                        body.push(chunk);
                    });
                    res.on('end', () =>
                    {
                        const bodyText = Buffer.concat(body).toString();
                        let returnData = "";
                        switch (res.headers['content-type'])
                        {
                            case 'application/json':
                                returnData = JSON.parse(bodyText);
                                break;
                            default:
                                returnData = { "message": bodyText, "statusCode": res.statusCode };
                        }
                        this.homey.app.updateLog("Post response: " + this.homey.app.varToString(returnData));
                        this.postInProgress = false;
                        //console.log("POST complete");
                        resolve(returnData);
                    });
                }).on('error', (err) =>
                {
                    this.homey.app.updateLog(err, 0);
                    this.postInProgress = false;
                    reject(new Error("HTTP Catch: " + err));
                });

                req.setTimeout(5000, function()
                {
                    req.destroy();
                    reject(new Error("HTTP Catch: Timeout"));
                    return;
                });

                req.write(bodyText);
                req.end();
            }
            catch (err)
            {
                this.homey.app.updateLog(this.homey.app.varToString(err), 0);
                this.postInProgress = false;
                reject(new Error("HTTP Catch: " + err));
            }
        });
    }

    async refreshBLEDevices()
    {
        let promises = [];

        const drivers = this.homey.drivers.getDrivers();
        for (const driver in drivers)
        {
            let devices = this.homey.drivers.getDriver(driver).getDevices();
            let numDevices = devices.length;
            for (var i = 0; i < numDevices; i++)
            {
                let device = devices[i];
                if (device.getDeviceValues)
                {
                    promises.push(device.getDeviceValues());
                }
            }
        }

        // Wait for all the checks to complete
        await Promise.allSettled(promises);
    }

    async newData(body)
    {
        this.updateLog(body);
        let promises = [];

        const drivers = this.homey.drivers.getDrivers();
        for (const driver in drivers)
        {
            let devices = this.homey.drivers.getDriver(driver).getDevices();
            let numDevices = devices.length;
            for (var i = 0; i < numDevices; i++)
            {
                let device = devices[i];
                if (device.syncBLEEvents)
                {
                    promises.push(device.syncBLEEvents(body));
                }
            }
        }

        // Wait for all the checks to complete
        await Promise.allSettled(promises);
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // SwitchBot Hub
    //    
    async onHubPoll()
    {
        var nextInterval = Number(this.homey.settings.get('pollInterval'));
        if (this.homey.app.BearerToken && (nextInterval > 0))
        {
            this.homey.app.updateLog("Polling hub");

            const promises = [];
            let totalHuBDevices = 0;

            const drivers = this.homey.drivers.getDrivers();
            for (const driver in drivers)
            {
                let devices = this.homey.drivers.getDriver(driver).getDevices();
                let numDevices = devices.length;
                for (var i = 0; i < numDevices; i++)
                {
                    let device = devices[i];
                    if (device.getHubDeviceValues)
                    {
                        totalHuBDevices++;
                        promises.push(device.getHubDeviceValues());
                    }
                }
            }

            await Promise.all(promises);

            if (totalHuBDevices > 0)
            {
                nextInterval *= (1000 * totalHuBDevices);
                if (nextInterval < (87000 * totalHuBDevices))
                {
                    nextInterval = (87000 * totalHuBDevices);
                }
            }
            else
            {
                nextInterval = 60000;
            }

            this.homey.app.updateLog("Next HUB polling interval = " + nextInterval, true);
        }
        else
        {
            nextInterval = 10000;
        }

        this.timerHubID = setTimeout(this.onHubPoll, nextInterval);
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Homey BLE
    //
    async onBLEPoll()
    {
        let pollingInterval = 1000;
        if (!this.discovering && !this.moving)
        {
            this.polling = true;
            pollingInterval = BLE_POLLING_INTERVAL;

            this.log("\r\nPolling BLE Starting ------------------------------------");

            this.homey.app.updateLog("Polling BLE Starting ------------------------------------");

            const promises = [];
            try
            {
                //clear BLE cache for each device
                const drivers = this.homey.drivers.getDrivers();
                // for (const driver in drivers)
                // {
                //     let devices = this.homey.drivers.getDriver(driver).getDevices();

                //     for (let i = 0; i < devices.length; i++)
                //     {
                //         let device = devices[i];
                //         let id = device.getData().id;
                //         delete this.homey.ble.__advertisementsByPeripheralUUID[id];
                //     }
                // }

                // Run discovery too fetch new data
                await this.homey.ble.discover(['cba20d00224d11e69fb80002a5d5c51b'], 2000);

                for (const driver in drivers)
                {
                    let devices = this.homey.drivers.getDriver(driver).getDevices();

                    for (let i = 0; i < devices.length; i++)
                    {
                        let device = devices[i];
                        if (device.getDeviceValues)
                        {
                            promises.push(device.getDeviceValues());
                        }
                    }

                    this.homey.app.updateLog("Polling BLE: waiting for devices to update");
                    await Promise.all(promises);
                }
            }
            catch (err)
            {
                this.homey.app.updateLog("BLE Polling Error: " + this.homey.app.varToString(err));
            }

            this.polling = false;
            this.log("------------------------------------ Polling BLE Finished\r\n");
        }
        else
        {
            this.log("Polling BLE skipped");
        }

        this.homey.app.updateLog("Next BLE polling interval = " + pollingInterval, true);

        this.timerID = setTimeout(this.onBLEPoll, pollingInterval);
    }

}

module.exports = MyApp;