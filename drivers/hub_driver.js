'use strict';

const Homey = require('homey');
const https = require("https");

class HubDriver extends Homey.Driver
{
    /**
     * onInit is called when the driver is initialized.
     */
    async onInit()
    {
        this.onPoll = this.onPoll.bind(this);
        this.timerID = setTimeout(this.onPoll, 10000);
    }

    async onPoll()
    {
        var nextInterval = Number(this.homey.settings.get('pollInterval'));
        if (this.homey.app.BearerToken && (nextInterval > 0))
        {
            this.homey.app.updateLog("Polling hub");

            const promises = [];
            let numDevices = 0;
            try
            {
                let devices = this.getDevices();
                numDevices = devices.length
                for (var i = 0; i < numDevices; i++)
                {
                    let device = devices[i];
                    if (device.getDeviceValues)
                    {
                        promises.push(device.getDeviceValues());
                    }
                }

                await Promise.all(promises);

            }
            catch (err)
            {
                this.homey.app.updateLog("Polling Error: " + this.varToString(err));
            }

            if (numDevices > 0)
            {
                nextInterval *= (1000 * numDevices);
                if (nextInterval < (87000 * numDevices))
                {
                    nextInterval = (87000 * numDevices);
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

        this.timerID = setTimeout(this.onPoll, nextInterval);
    }

    async getHUBDevices(type)
    {
        const devices = [];

        //https://api.switch-bot.com/v1/devices
        const url = "devices";
        let response = await this.GetURL(url);
        if (response)
        {
            if (response.statusCode !== 100)
            {
                this.homey.app.updateLog("Invalid response code: " + response.statusCode);
                throw (new Error("Invalid response code: " + response.statusCode));
            }

            let searchData = response.body;
            this.homey.app.detectedDevices = this.homey.app.varToString(searchData);
            this.homey.api.realtime('com.switchbot.detectedDevicesUpdated', { 'devices': this.homey.app.detectedDevices });

            const devices = [];

            // Create an array of devices
            for (const device of searchData['deviceList'])
            {
                if (device.deviceType === type)
                {
                    this.homey.app.updateLog("Found device: ");
                    this.homey.app.updateLog(device);

                    var data = {};
                    data = {
                        "id": device['deviceId'],
                    };

                    // Add this device to the table
                    devices.push(
                    {
                        "name": device['deviceName'],
                        data
                    })
                }
            }
            return devices;
        }
        else
        {
            this.homey.app.updateLog("Getting API Key returned NULL");
            throw( new Error("HTTPS Error: Nothing returned"));
        }
    }

    async getDeviceData(deviceId)
    {
        //https://api.switch-bot.com/v1/devices/deviceId/status
        const url = "devices/" + deviceId + "/status";
        let response = await this.GetURL(url);
        if (response)
        {
            if (response.statusCode !== 100)
            {
                this.homey.app.updateLog("Invalid response code: " + response.statusCode + ":  " + response.message);
                throw( new Error(response.message));
            }

            return response.body;
        }

        this.homey.app.updateLog("Invalid response: No data");
        throw( new Error("Invalid response: No data"));
    }

    async setDeviceData(deviceId, body)
    {
        //https://api.switch-bot.com/v1/devices/commands
        const url = "devices/" + deviceId + "/commands";
        let response = await this.PostURL(url, body);
        if (response)
        {
            if (response.statusCode !== 100)
            {
                this.homey.app.updateLog("Invalid response code: " + response.statusCode + ":  " + response.message);
                throw( new Error(response.message));
            }

            return true;
        }

        this.homey.app.updateLog("Invalid response: No data");
        throw( new Error("Invalid response: No data"));
    }

    async GetURL(url)
    {
        // if ( ( process.env.DEBUG === '1' ) && ( url === 'devices' ) )
        // {
        //     const simData = this.homey.settings.get( 'simData' );
        //     if ( simData )
        //     {
        //         return { 'body': simData };
        //     }
        // }

        this.homey.app.updateLog(url);

        return new Promise((resolve, reject) =>
        {
            try
            {
                if (!this.homey.app.BearerToken)
                {
                    reject(new Error("Invalid Token."));
                    return;
                }

                let https_options = {
                    host: "api.switch-bot.com",
                    path: "/v1.0/" + url,
                    headers:
                    {
                        "Authorization": this.homey.app.BearerToken,
                    },
                }

                https.get(https_options, (res) =>
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
                        this.homey.app.updateLog("HTTPS Error: " + res.statusCode + ": " + message);
                        reject(new Error("HTTPS Error: " + message))
                        return;
                    }
                }).on('error', (err) =>
                {
                    this.homey.app.updateLog(err);
                    reject(new Error("HTTPS Catch: " + err))
                    return;
                });
            }
            catch (err)
            {
                this.homey.app.updateLog(err);
                reject(new Error("HTTPS Catch: " + err))
                return;
            }
        });
    }

    async PostURL(url, body)
    {
        this.homey.app.updateLog(url);
        let bodyText = JSON.stringify(body);
        this.homey.app.updateLog(bodyText);

        return new Promise((resolve, reject) =>
        {
            try
            {
                if (!this.homey.app.BearerToken)
                {
                    reject(new Error("HTTPS: No Token specified"))
                    return;
                }

                let https_options = {
                    host: "api.switch-bot.com",
                    path: "/v1.0/" + url,
                    method: "POST",
                    headers:
                    {
                        "Authorization": this.homey.app.BearerToken,
                        "contentType": "application/json; charset=utf-8",
                        "Content-Length": bodyText.length
                    },
                }

                this.homey.app.updateLog(https_options);

                let req = https.request(https_options, (res) =>
                {
                    if (res.statusCode === 200)
                    {
                        let body = [];
                        res.on('data', (chunk) =>
                        {
                            this.homey.app.updateLog("Post: retrieve data");
                            body.push(chunk);
                        });
                        res.on('end', () =>
                        {
                            let returnData = JSON.parse(Buffer.concat(body));
                            this.homey.app.updateLog("Post response: " + this.homey.app.varToString(returnData));
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
                        this.homey.app.updateLog("HTTPS Error: " + res.statusCode + ": " + message);
                        reject(new Error("HTTPS Error: " + message));
                    }
                }).on('error', (err) =>
                {
                    this.homey.app.updateLog(err);
                    reject(new Error("HTTPS Catch: " + err));
                });
                req.write(bodyText);
                req.end();
            }
            catch (err)
            {
                this.homey.app.updateLog(this.homey.app.varToString(err));
                reject(new Error("HTTPS Catch: " + err));
            }
        });
    }
}

module.exports = HubDriver;