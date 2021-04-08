/*jslint node: true */
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
    }

    async getHUBDevices(type, RemoteList = false)
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

            if (RemoteList)
            {
                // Create an array of devices
                for (const device of searchData.infraredRemoteList)
                {
                    if (device.remoteType === type)
                    {
                        this.homey.app.updateLog("Found device: ");
                        this.homey.app.updateLog(device);

                        let data = {};
                        data = {
                            "id": device.deviceId,
                        };

                        // Add this device to the table
                        devices.push(
                            {
                                "name": device.deviceName,
                                data
                            });
                    }
                }
            }
            else
            {
                // Create an array of devices
                for (const device of searchData.deviceList)
                {
                    if (device.deviceType === type)
                    {
                        this.homey.app.updateLog("Found device: ");
                        this.homey.app.updateLog(device);

                        let data = {};
                        data = {
                            "id": device.deviceId,
                        };

                        // Add this device to the table
                        devices.push(
                            {
                                "name": device.deviceName,
                                data
                            });
                    }
                }
            }
            return devices;
        }
        else
        {
            this.homey.app.updateLog("Getting API Key returned NULL");
            throw (new Error("HTTPS Error: Nothing returned"));
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
                throw (new Error(response.message));
            }

            return response.body;
        }

        this.homey.app.updateLog("Invalid response: No data");
        throw (new Error("Invalid response: No data"));
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
                throw (new Error(response.message));
            }

            return true;
        }

        this.homey.app.updateLog("Invalid response: No data");
        throw (new Error("Invalid response: No data"));
    }

    async GetURL(url)
    {
        if ((process.env.DEBUG === '1') && (url === 'devices'))
        {
            const simData = this.homey.settings.get('simData');
            if (simData)
            {
                const bodyJSON = JSON.parse(simData);
                return { 'body': bodyJSON, 'statusCode': 100 };
            }
        }

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
                };

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
                        reject(new Error("HTTPS Error: " + message));
                        return;
                    }
                }).on('error', (err) =>
                {
                    this.homey.app.updateLog(this.homey.app.varToString(err));
                    reject(new Error("HTTPS Catch: " + err));
                    return;
                });
            }
            catch (err)
            {
                this.homey.app.updateLog(this.homey.app.varToString(err));
                reject(new Error("HTTPS Catch: " + err));
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
                    reject(new Error("HTTPS: No Token specified"));
                    return;
                }

                const safeUrl = encodeURI(url);

                let https_options = {
                    host: "api.switch-bot.com",
                    path: "/v1.0/" + safeUrl,
                    method: "POST",
                    headers:
                    {
                        "Authorization": this.homey.app.BearerToken,
                        "contentType": "application/json; charset=utf-8",
                        "Content-Length": bodyText.length
                    },
                };

                this.homey.app.updateLog(this.homey.app.varToString(https_options));

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
                    this.homey.app.updateLog(this.homey.app.varToString(err));
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