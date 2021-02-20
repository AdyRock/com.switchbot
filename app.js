'use strict';
if (process.env.DEBUG === '1')
{
    require('inspector').open(9222, '0.0.0.0', true)
}

const Homey = require('homey');
const http = require("http");
var mdns = require('multicast-dns')({ multicast: false, loopback: false })

const MINIMUM_POLL_INTERVAL = 5;

class MyApp extends Homey.App
{
    /**
     * onInit is called when the app is initialized.
     */
    async onInit()
    {
        this.log('SwitchBot has been initialized');
        this.diagLog = "";

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

        this.log("Switchbot has started with Key: " + this.BearerToken + " Polling every " + this.homey.settings.get('pollInterval') + " seconds");

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

        mdns.on('response', (response) =>
        {
            if (this.enableBLEHub)
            {
                const answer = response.answers.find(answer => answer.name === 'switchbotble.local');
                if (answer)
                {
                    console.log('got a response packet:', response)
                    this.BLEHubAddress = answer.data;
                    this.usingBLEHub = true;
                    clearTimeout(this.timerBLEHubID);
                    this.timerBLEHubID = setTimeout(this.onBLEHubPoll, 3000);
                }
            }
        })

        if (this.enableBLEHub)
        {
            // lets query for an A record for 'brunhilde.local'
            mdns.query(
            {
                questions: [
                {
                    name: 'switchbotble.local',
                    type: 'A'
                }]
            })
        }

        this.homeyId = await this.homey.cloud.getLocalAddress();

        this.onBLEHubPoll = this.onBLEHubPoll.bind(this);
        this.timerBLEHubID = setTimeout(this.onBLEHubPoll, (1000 * 10));
        
        this.onHubPoll = this.onHubPoll.bind(this);
        this.timerHubID = setTimeout(this.onHubPoll, 10000);

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
            this.log("VarToString Erro: ", err);
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
            return await this.GetBLEHubURL(url);
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
            return await this.GetBLEHubURL(url);
        }
        catch (err)
        {
            this.homey.app.updateLog(err, 0);
        }

        return null;
    }

    async onBLEHubPoll()
    {
        if (this.usingBLEHub)
        {
            this.refreshBLEHubCallback();
            this.timerBLEHubID = setTimeout(this.onBLEHubPoll, 1000 * 60 * 5);
        }
        else
        {
            // lets query for an A record for 'brunhilde.local'
            mdns.query(
            {
                questions: [
                {
                    name: 'switchbotble.local',
                    type: 'A'
                }]
            })
            this.timerBLEHubID = setTimeout(this.onBLEHubPoll, 1000 * 10);
        }
    }

    async sendBLECommand(address, command)
    {
        try
        {
            const url = "device/write";
            this.homey.app.updateLog("Request to write: " + command + " to " + address);
            const body = { "address": address, data: command };
            let response = await this.PostBLEHubURL(url, body);
            if (response)
            {
                if (response.statusCode !== 200)
                {
                    this.homey.app.updateLog("Invalid response code: " + response.statusCode + ":  " + response.message, 0);
                    return false;
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

    async refreshBLEHubCallback()
    {
        try
        {
            const url = "callback/add";
            const callbackUrl = "http://" + this.homeyId + "/api/app/com.switchbot/newData/";
            this.homey.app.updateLog("Registering callback: " + callbackUrl);
            const body = { "uri": callbackUrl };
            let response = await this.PostBLEHubURL(url, body);
            if (response)
            {
                if (response.statusCode !== 200)
                {
                    this.homey.app.updateLog("Invalid response code: " + response.statusCode + ":  " + response.message, 0);
                    return false;
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

    async GetBLEHubURL(url)
    {
        this.homey.app.updateLog(url);

        return new Promise((resolve, reject) =>
        {
            try
            {
                let http_options = {
                    host: this.BLEHubAddress,
                    path: "/api/v1/" + url,
                    timeout: 30000
                }

                http.get(http_options, (res) =>
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
                            let returnData = JSON.parse(Buffer.concat(body));
                            this.homey.app.updateLog("Get response: " + this.homey.app.varToString(returnData));
                            resolve(returnData);
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
                        reject(new Error("HTTP Error: " + message))
                        return;
                    }
                }).on('error', (err) =>
                {
                    this.homey.app.updateLog(err, 0);
                    reject(new Error("HTTP Catch: " + err))
                    return;
                });
            }
            catch (err)
            {
                this.homey.app.updateLog(err, 0);
                reject(new Error("HTTP Catch: " + err))
                return;
            }
        });
    }

    async PostBLEHubURL(url, body)
    {
        this.homey.app.updateLog(url);
        let bodyText = JSON.stringify(body);
        this.homey.app.updateLog(bodyText);

        return new Promise((resolve, reject) =>
        {
            if (this.postInProgress)
            {
                reject({ "message": "Busy", "statusCode": 300 });
            }

            this.postInProgress = true;

            try
            {
                let http_options = {
                    host: this.BLEHubAddress,
                    path: "/api/v1/" + url,
                    method: "POST",
                    headers:
                    {
                        "contentType": "application/json; charset=utf-8",
                        "Content-Length": bodyText.length,
                        "connection": 'Close'
                    },
                }

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
                        console.log("POST complete");
                        resolve(returnData);
                    });
                }).on('error', (err) =>
                {
                    this.homey.app.updateLog(err, 0);
                    this.postInProgress = false;
                    reject(new Error("HTTP Catch: " + err));
                });

                req.setTimeout(15000, function() { req.abort(); })

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

    async newData(body)
    {
        this.updateLog(body);
        let promises = [];

        const drivers = this.homey.drivers.getDrivers();
        for (const driver in drivers)
        {
            this.homey.drivers.getDriver(driver).getDevices().forEach(device =>
            {
                try
                {
                    if (device.syncBLEEvents)
                    {
                        promises.push(device.syncBLEEvents(body));
                    }
                }
                catch (error)
                {
                    this.updateLog("Sync Devices", error);
                }
            })
        }

        // Wait for all the checks to complete
        await Promise.allSettled(promises);
    }


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
                nextInterval = 60000
            }

            this.homey.app.updateLog("Next HUB polling interval = " + nextInterval, true);
        }
        else
        {
            nextInterval = 10000;
        }

        this.timerBLEHubID = setTimeout(this.onBLEHubPoll, nextInterval);
    }


}

module.exports = MyApp;