/* eslint-disable camelcase */
/* jslint node: true */

'use strict';

const https = require('https');

// Utility file to interface to the SwitchBot hub
class hub_interface
{

    constructor(HomeyInstance)
    {
        this.homey = HomeyInstance;
        return this;
    }

    async getHUBDevices(oAuth2Client, type, RemoteList = false)
    {
        const response = await oAuth2Client.getDevices();
        if (response)
        {
            if (response.statusCode !== 100)
            {
                this.homey.app.updateLog(`Invalid response code: ${response.statusCode}`);
                throw (new Error(`Invalid response code: ${response.statusCode}`));
            }

            const searchData = response.body;
            this.homey.app.detectedDevices = this.homey.app.varToString(searchData);

            if (type === '')
            {
                // Called from settings screen sp no need to process the data
                return this.homey.app.detectedDevices;
            }

            if (this.homey.app.BLEHub)
            {
                // Running on a Homey Pro
                this.homey.api.realtime('com.switchbot.detectedDevicesUpdated', { devices: this.homey.app.detectedDevices });
            }

            const devices = [];

            if (RemoteList)
            {
                // Create an array of devices
                for (const device of searchData.infraredRemoteList)
                {
                    if ((device.remoteType === type) || (device.remoteType === (`DIY ${type}`)))
                    {
                        this.homey.app.updateLog('Found device: ');
                        this.homey.app.updateLog(device);

                        let data = {};
                        data = {
                            id: device.deviceId,
                        };

                        // Add this device to the table
                        devices.push(
                            {
                                name: device.deviceName,
                                data,
                            },
                        );
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
                        this.homey.app.updateLog('Found device: ');
                        this.homey.app.updateLog(device);

                        let data = {};
                        data = {
                            id: device.deviceId,
                        };

                        // Add this device to the table
                        devices.push(
                            {
                                name: device.deviceName,
                                data,
                            },
                        );
                    }
                }
            }
            return devices;
        }

            this.homey.app.updateLog('Getting API Key returned NULL');
            throw (new Error('HTTPS Error: Nothing returned'));
    }

    async getScenes(oAuth2Client)
    {
        const response = await oAuth2Client.getScenes();
        if (response)
        {
            if (response.statusCode !== 100)
            {
                this.homey.app.updateLog(`Invalid response code: ${response.statusCode}`);
                throw (new Error(`Invalid response code: ${response.statusCode}`));
            }

            const searchData = response.body;
            this.homey.app.detectedDevices = this.homey.app.varToString(searchData);
            if (this.homey.app.BLEHub)
            {
                this.homey.api.realtime('com.switchbot.detectedDevicesUpdated', { devices: this.homey.app.detectedDevices });
            }

            const devices = [];

            // Create an array of devices
            for (const device of searchData)
            {
                this.homey.app.updateLog('Found device: ');
                this.homey.app.updateLog(device);

                let data = {};
                data = {
                    id: device.sceneId,
                };

                // Add this device to the table
                devices.push(
                {
                    name: device.sceneName,
                    data,
                },
);
            }
            return devices;
        }

            this.homey.app.updateLog('Getting API Key returned NULL');
            throw (new Error('HTTPS Error: Nothing returned'));
    }

    async getDeviceData(oAuth2Client, deviceId)
    {
        const response = await oAuth2Client.getDeviceData(deviceId);
        if (response)
        {
            if (response.statusCode !== 100)
            {
                this.homey.app.updateLog(`Invalid response code: ${response.statusCode}:  ${response.message}`);
                throw (new Error(response.message));
            }

            return response.body;
        }

        this.homey.app.updateLog('Invalid response: No data');
        throw (new Error('Invalid response: No data'));
    }

    async setDeviceData(oAuth2Client, deviceId, body)
    {
        const response = await oAuth2Client.setDeviceData(deviceId, body);
        if (response)
        {
            if (response.statusCode !== 100)
            {
                this.homey.app.updateLog(`Invalid response code: ${response.statusCode}:  ${response.message}`);
                throw (new Error(response.message));
            }

            return true;
        }

        this.homey.app.updateLog('Invalid response: No data');
        throw (new Error('Invalid response: No data'));
    }

    async GetURL(url)
    {
        if ((process.env.DEBUG === '1') && (url === 'devices'))
        {
            const simData = this.homey.settings.get('simData');
            if (simData)
            {
                const bodyJSON = JSON.parse(simData);
                return { body: bodyJSON, statusCode: 100 };
            }
        }

        this.homey.app.updateLog(url);

        return new Promise((resolve, reject) =>
        {
            try
            {
                if (!this.homey.app.BearerToken)
                {
                    reject(new Error('Invalid Token.'));
                    return;
                }

                const httpsOptions = {
                    host: 'api.switch-bot.com',
                    path: `/v1.0/${url}`,
                    headers:
                    {
                        Authorization: this.homey.app.BearerToken,
                    },
                };

                https.get(httpsOptions, res =>
                {
                    if (res.statusCode === 200)
                    {
                        const body = [];
                        res.on('data', chunk =>
                        {
                            body.push(chunk);
                        });
                        res.on('end', () =>
                        {
                            const returnData = JSON.parse(Buffer.concat(body));
                            this.homey.app.updateLog(`Get response: ${this.homey.app.varToString(returnData)}`, 2);
                            resolve(returnData);
                        });
                    }
                    else
                    {
                        let message = '';
                        if (res.statusCode === 204)
                        {
                            message = 'No Data Found';
                        }
                        else if (res.statusCode === 400)
                        {
                            message = 'Bad request';
                        }
                        else if (res.statusCode === 401)
                        {
                            message = 'Unauthorized';
                        }
                        else if (res.statusCode === 403)
                        {
                            message = 'Forbidden';
                        }
                        else if (res.statusCode === 404)
                        {
                            message = 'Not Found';
                        }
                        this.homey.app.updateLog(`HTTPS Error: ${res.statusCode}: ${message}`);
                        reject(new Error(`HTTPS Error: ${message}`));
                    }
                }).on('error', err =>
                {
                    this.homey.app.updateLog(this.homey.app.varToString(err));
                    reject(new Error(`HTTPS Catch: ${err.message}`));
                });
            }
            catch (err)
            {
                this.homey.app.updateLog(this.homey.app.varToString(err));
                reject(new Error(`HTTPS Catch: ${err.message}`));
            }
        });
    }

    async PostURL(url, body)
    {
        if (body === undefined)
        {
            body = '';
        }

        this.homey.app.updateLog(url);
        const bodyText = JSON.stringify(body);
        this.homey.app.updateLog(bodyText);

        return new Promise((resolve, reject) =>
        {
            try
            {
                if (!this.homey.app.BearerToken)
                {
                    reject(new Error('HTTPS: No Token specified'));
                    return;
                }

                const safeUrl = encodeURI(url);

                const httpsOptions = {
                    host: 'api.switch-bot.com',
                    path: `/v1.0/${safeUrl}`,
                    method: 'POST',
                    headers:
                    {
                        Authorization: this.homey.app.BearerToken,
                        contentType: 'application/json; charset=utf-8',
                        'Content-Length': bodyText.length,
                    },
                };

                this.homey.app.updateLog(this.homey.app.varToString(httpsOptions));

                const req = https.request(httpsOptions, res =>
                {
                    if (res.statusCode === 200)
                    {
                        const body = [];
                        res.on('data', chunk =>
                        {
                            this.homey.app.updateLog('Post: retrieve data');
                            body.push(chunk);
                        });
                        res.on('end', () =>
                        {
                            const returnData = JSON.parse(Buffer.concat(body));
                            this.homey.app.updateLog(`Post response: ${this.homey.app.varToString(returnData)}`);
                            resolve(returnData);
                        });
                    }
                    else
                    {
                        let message = '';
                        if (res.statusCode === 204)
                        {
                            message = 'No Data Found';
                        }
                        else if (res.statusCode === 400)
                        {
                            message = 'Bad request';
                        }
                        else if (res.statusCode === 401)
                        {
                            message = 'Unauthorized';
                        }
                        else if (res.statusCode === 403)
                        {
                            message = 'Forbidden';
                        }
                        else if (res.statusCode === 404)
                        {
                            message = 'Not Found';
                        }
                        this.homey.app.updateLog(`HTTPS Error: ${res.statusCode}: ${message}`);
                        reject(new Error(`HTTPS Error: ${message}`));
                    }
                }).on('error', err =>
                {
                    this.homey.app.updateLog(this.homey.app.varToString(err));
                    reject(new Error(`HTTPS Catch: ${err.message}`));
                });
                req.write(bodyText);
                req.end();
            }
            catch (err)
            {
                this.homey.app.updateLog(this.homey.app.varToString(err));
                reject(new Error(`HTTPS Catch: ${err.message}`));
            }
        });
    }

}

module.exports = hub_interface;
