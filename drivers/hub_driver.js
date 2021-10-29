/*jslint node: true */
'use strict';

const Homey = require('homey');
const hubInterface = require("../lib/hub_interface");

class HubDriver extends Homey.Driver
{
    /**
     * onInit is called when the driver is initialized.
     */
    async onInit()
    {
        this.hub = new hubInterface(this.homey);
    }

    async getHUBDevices(type, RemoteList = false)
    {
        return await this.hub.getHUBDevices(type, RemoteList);
    }

    async getScenes()
    {
        return await this.hub.getScenes();
    }

    async getDeviceData(deviceId)
    {
        return await this.hub.getDeviceData(deviceId);
    }

    async setDeviceData(deviceId, body)
    {
        return await this.hub.setDeviceData(deviceId, body);
    }

    async GetURL(url)
    {
        return await this.hub.GetURL(url);
    }

    async PostURL(url, body)
    {
        return await this.hub.PostURL(url, body);
    }

    async onPair(session)
    {
        let oldAPICode = this.homey.app.BearerToken;
        session.setHandler("list_devices", async () =>
        {
            try
            {
                let devices = await this.onPairListDevices();
                this.homey.settings.set('BearerToken', this.homey.app.BearerToken);
                return devices;
            }
            catch (err)
            {
                this.homey.app.BearerToken = oldAPICode;
                throw new Error(err.message);
            }
        });

        session.setHandler('api_code_setup', async () =>
        {
            return this.homey.app.BearerToken;
        });

        session.setHandler('api_connection', async (data) =>
        {
            if (data.api_token)
            {
                this.homey.app.BearerToken = data.api_token;
                return true;
            }

            return false;
        });
    }

    async onRepair(session, device)
    {
        // Argument socket is an EventEmitter, similar to Driver.onPair
        // Argument device is a Homey.Device that's being repaired

        session.setHandler('api_code_setup', async () =>
        {
            return this.homey.app.BearerToken;
        });

        session.setHandler('api_connection', async (data) =>
        {
            if (data.api_token)
            {
                this.homey.app.BearerToken = data.api_token;
                await device.getHubDeviceValues();
                if (device.getAvailable())
                {
                    this.homey.settings.set('BearerToken', this.homey.app.BearerToken);
                    return true;
                }
            }

            return false;
        });
    }
}

module.exports = HubDriver;