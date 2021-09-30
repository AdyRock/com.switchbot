/*jslint node: true */
'use strict';

const Homey = require('homey');
const http = require("http");
const dgram = require('dgram');

class BLEHub_interface
{
    constructor( HomeyInstance, HomeyIP )
    {
        this.homey = HomeyInstance;
        this.enableBLEHub = true;
        this.usingBLEHub = false;
        this.BLEHubs = [];
        this.homeyIP = HomeyIP;

        this.creatBLEHubServer();
        return this;
    }

    creatBLEHubServer()
    {
        // Create a server to listen for data from ESP32 BLE hub
        const server = dgram.createSocket('udp4');
        server.on('error', (err) =>
        {
            this.homey.app.updateLog(`server error:\n${err.stack}`, 0);
            server.close();
            this.enableBLEHub = false;
        });

        server.on('message', (msg, rinfo) =>
        {
            this.homey.app.updateLog(`server got: ${msg} from ${rinfo.address}:${rinfo.port}`);
            // Make sure we have a hub registered
            if (this.enableBLEHub)
            {
                // Validate the message to confirm it is from a hub
                let msgTxt = msg.toString();
                if (msgTxt.indexOf('SwitchBot BLE Hub!') == 0)
                {
                    let newAddress = false;

                    // Get the hubs MAC addredd
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
            this.homey.app.updateLog(`server listening ${address.address}:${address.port}`);
        });

        server.bind(1234, () =>
        {
            server.addMembership('239.1.2.3');
            this.homey.setTimeout(() => { server.send("Are you there SwitchBot?", 1234, '239.1.2.3'); }, 500);
        });

    }

    async getBLEHubDevices()
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

    async getBLEHubDevice(Address)
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

    async sendBLEHubCommand(address, command, bestHub)
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
            const callbackUrl = "http://" + this.homeyIP + "/api/app/com.switchbot/newData/";
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
                    this.refreshBLEHubDevices();
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

                this.homey.app.updateLog(this.homey.app.varToString(err), 0);
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
                    timeout: 5000
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
                    this.homey.app.updateLog(this.homey.app.varToString(err), 0);
                    reject(new Error("HTTP Catch: " + err));
                    return;
                });

                req.setTimeout(5000, function()
                {
                    req.destroy();
                    reject(new Error("HTTP Catch: Timeout"));
                    return;
                });
            }
            catch (err)
            {
                this.homey.app.updateLog(this.homey.app.varToString(err), 0);
                reject(new Error("HTTP Catch: " + err));
                return;
            }
        });
    }

    IsBLEHubAvailable(hubMAC)
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
                    this.homey.app.updateLog(this.homey.app.varToString(err), 0);
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
                this.homey.app.updateLog(this.homey.app.varToString(err), 0);
            }
        }

        if (responses.length == 0)
        {
            responses.push({ statusCode: 410, message: "No hubs" });
        }
        return responses;
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
            this.homey.app.updateLog("\n*** POST IN PROGRESS ***\n\n");
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

                this.homey.app.updateLog(this.homey.app.varToString(http_options));

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
                        this.homey.app.updateLog("POST complete");
                        resolve(returnData);
                    });
                }).on('error', (err) =>
                {
                    this.homey.app.updateLog(this.homey.app.varToString(err), 0);
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

    async refreshBLEHubDevices()
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

    async newBLEHubData(body)
    {
        if (Symbol.iterator in Object(body))
        {
            this.homey.app.updateLog(this.homey.app.varToString(body));
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
    }

}
module.exports = BLEHub_interface;