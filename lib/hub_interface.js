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

    async getScenes()
    {
        // https://api.switch-bot.com/v1.0/scenes
        const url = 'scenes';
        const response = await this.GetURL(url);
        if (response)
        {
            if (response.statusCode !== 100)
            {
                this.homey.app.updateLog(`Invalid response code: ${response.statusCode}`, 0);
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

            this.homey.app.updateLog('Getting API Key returned NULL', 0);
            throw (new Error('HTTPS Error: Nothing returned'));
    }

    async getDeviceData(deviceId)
    {
        // https://api.switch-bot.com/v1/devices/deviceId/status
        const url = `devices/${deviceId}/status`;
        const response = await this.GetURL(url);
        if (response)
        {
            if (response.statusCode !== 100)
            {
                this.homey.app.updateLog(`Invalid response code: ${response.statusCode}:  ${response.message}`, 0);
                throw (new Error(response.message));
            }

            return response.body;
        }

        this.homey.app.updateLog('Invalid response: No data', 0);
        throw (new Error('Invalid response: No data'));
    }

    async setDeviceData(deviceId, body)
    {
        // https://api.switch-bot.com/v1/devices/commands
        const url = `devices/${deviceId}/commands`;
        const response = await this.PostURL(url, body);
        if (response)
        {
            if (response.statusCode !== 100)
            {
                this.homey.app.updateLog(`Invalid response code: ${response.statusCode}:  ${response.message}`, 0);
                throw (new Error(response.message));
            }

            return true;
        }

        this.homey.app.updateLog('Invalid response: No data', 0);
        throw (new Error('Invalid response: No data'));
    }

    async startScene(deviceId)
    {
        const url = `scenes/${deviceId}/execute`;
        const response = await this.PostURL(url);
        if (response)
        {
            if (response.statusCode !== 100)
            {
                this.homey.app.updateLog(`Invalid response code: ${response.statusCode}:  ${response.message}`, 0);
                throw (new Error(response.message));
            }

            return true;
        }

        this.homey.app.updateLog('Invalid response: No data', 0);
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
                            this.homey.app.updateLog(`Get response: ${this.homey.app.varToString(returnData)}`, 3);
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
                        this.homey.app.updateLog(`HTTPS Error: ${res.statusCode}: ${message}`, 0);
                        reject(new Error(`HTTPS Error: ${message}`));
                    }
                }).on('error', err =>
                {
                    this.homey.app.updateLog(this.homey.app.varToString(err), 0);
                    reject(new Error(`HTTPS On Error: ${err.message}`));
                });
            }
            catch (err)
            {
                this.homey.app.updateLog(this.homey.app.varToString(err), 0);
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
                        else if (res.statusCode === 174)
                        {
                            message = 'Cloud option is not enabled in the SwitchBot app';
                        }
                        this.homey.app.updateLog(`HTTPS Error: ${res.statusCode}: ${message}`, 0);
                        reject(new Error(`HTTPS Error: ${message}`));
                    }
                }).on('error', err =>
                {
                    this.homey.app.updateLog(this.homey.app.varToString(err), 0);
                    reject(new Error(`HTTPS On Error: ${err.message}`));
                });
                req.write(bodyText);
                req.end();
            }
            catch (err)
            {
                this.homey.app.updateLog(this.homey.app.varToString(err), 0);
                reject(new Error(`HTTPS Catch: ${err.message}`));
            }
        });
    }

}

module.exports = hub_interface;
