/* jslint node: true */

'use strict';

const { OAuth2Driver } = require('homey-oauth2app');

class HubDriver extends OAuth2Driver
{

    async getHUBDevices(oAuth2Client, type, RemoteList = false)
    {
        let response = null;

        if (process.env.DEBUG === '1')
        {
            const simData = this.homey.settings.get('simData');
            if (simData)
            {
                const bodyJSON = JSON.parse(simData);
                response = { body: bodyJSON, statusCode: 100 };
            }
        }

        if (response === null)
        {
            response = await oAuth2Client.getDevices();
        }

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
                        this.homey.app.updateLog(this.homey.app.varToString(device));

                        let data = {};
                        if (device.remoteType === (`DIY ${type}`))
                        {
                            data = {
                                id: device.deviceId,
                                diy: true
                            };
                        }
                        else
                        {
                            data = {
                                id: device.deviceId,
                            };
                        }

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
                    let found = false;
                    if (Array.isArray(type))
                    {
                        found = (type.findIndex(typeEntry => typeEntry === device.deviceType) >= 0);
                    }
                    else
                    {
                        found = (device.deviceType === type);
                    }
                    if (found)
                    {
                        if ((type !== 'Curtain') || (device.master === true))
                        {
                            this.homey.app.updateLog('Found device: ');
                            this.homey.app.updateLog(this.homey.app.varToString(device));

                            let data = {};
                            data = {
                                id: device.deviceId,
                                type: device.deviceType
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
                this.homey.app.updateLog(this.homey.app.varToString(device));

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

}

module.exports = HubDriver;
