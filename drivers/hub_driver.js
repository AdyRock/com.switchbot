'use strict';

const Homey = require('homey');
const https = require("https");

class HubDriver extends Homey.Driver
{
    /**
     * onInit is called when the driver is initialized.
     */
    async onInit() {}

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
                Homey.app.updateLog("Invalid response code: " + response.statusCode);
                throw( new Error("Invalid response code: " + response.statusCode));
            }

            let searchData = response.body;
            Homey.app.detectedDevices = Homey.app.varToString(searchData);
            Homey.ManagerApi.realtime('com.switchbot.detectedDevicesUpdated', { 'devices': Homey.app.detectedDevices });

            const devices = [];

            // Create an array of devices
            for (const device of searchData['deviceList'])
            {
                if (device.deviceType === type)
                {
                    Homey.app.updateLog("Found device: ");
                    Homey.app.updateLog(device);

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
            Homey.app.updateLog("Getting API Key returned NULL");
            reject(
            {
                statusCode: -3,
                statusMessage: "HTTPS Error: Nothing returned"
            });
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
                Homey.app.updateLog("Invalid response code: " + response.statusCode);
                return null;
            }

            return response.body;
        }

        Homey.app.updateLog("Invalid response: No data");
        return null;
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
                Homey.app.updateLog("Invalid response code: " + response.statusCode);
                return false;
            }

            return true;
        }

        Homey.app.updateLog("Invalid response: No data");
        return false;
    }

    async GetURL(url)
    {
        // if ( ( process.env.DEBUG === '1' ) && ( url === 'devices' ) )
        // {
        //     const simData = Homey.ManagerSettings.get( 'simData' );
        //     if ( simData )
        //     {
        //         return { 'body': simData };
        //     }
        // }

        Homey.app.updateLog(url);

        return new Promise((resolve, reject) =>
        {
            try
            {
                if (!Homey.app.BearerToken)
                {
                    reject(new Error("Invalid Token."));
                    return;
                }

                let https_options = {
                    host: "api.switch-bot.com",
                    path: "/v1.0/" + url,
                    headers:
                    {
                        "Authorization": Homey.app.BearerToken,
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
                            let returnData = JSON.parse( Buffer.concat(body));
                            Homey.app.updateLog("Get response: " + Homey.app.varToString(returnData));
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
                        Homey.app.updateLog("HTTPS Error: " + res.statusCode + ": " + message);
                        reject(new Error( "HTTPS Error: " + message))
                        return;
                    }
                }).on('error', (err) =>
                {
                    Homey.app.updateLog(err);
                    reject(new Error( "HTTPS Catch: " + err))
                    return;
                });
            }
            catch (err)
            {
                Homey.app.updateLog(err);
                reject(new Error( "HTTPS Catch: " + err))
                return;
            }
        });
    }

    async PostURL(url, body)
    {
        Homey.app.updateLog(url);
        let bodyText = JSON.stringify(body);
        Homey.app.updateLog(bodyText);

        return new Promise((resolve, reject) =>
        {
            try
            {
                if (!Homey.app.BearerToken)
                {
                    reject(new Error( "HTTPS: No Token specified"))
                    return;
                }

                let https_options = {
                    host: "api.switch-bot.com",
                    path: "/v1.0/" + url,
                    method: "POST",
                    headers:
                    {
                        "Authorization": Homey.app.BearerToken,
                        "contentType": "application/json; charset=utf-8",
                        "Content-Length": bodyText.length
                    },
                }

                Homey.app.updateLog(https_options);

                let req = https.request(https_options, (res) =>
                {
                    if (res.statusCode === 200)
                    {
                        let body = [];
                        res.on('data', (chunk) =>
                        {
                            Homey.app.updateLog("Post: retrieve data");
                            body.push(chunk);
                        });
                        res.on('end', () =>
                        {
                            let returnData = JSON.parse( Buffer.concat(body));
                            Homey.app.updateLog("Post response: " + Homey.app.varToString(returnData));
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
                        Homey.app.updateLog("HTTPS Error: " + res.statusCode + ": " + message);
                        reject(new Error( "HTTPS Error: " + message));
                    }
                }).on('error', (err) =>
                {
                    Homey.app.updateLog(err);
                    reject(new Error( "HTTPS Catch: " + err));
                });
                req.write(bodyText);
                req.end();
            }
            catch (err)
            {
                Homey.app.updateLog(Homey.app.varToString(err));
                reject(new Error( "HTTPS Catch: " + err));
            }
        });
    }
}

module.exports = HubDriver;