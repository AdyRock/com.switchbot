/* jslint node: true */

'use strict';

const { OAuth2Driver } = require('homey-oauth2app');

const HubInterface = require('../lib/hub_interface');

class HubDriver extends OAuth2Driver
{

    /**
     * onInit is called when the driver is initialized.
     */
    async onOAuth2Init()
    {
        this.hub = new HubInterface(this.homey);
    }

    async getHUBDevices(oAuth2Client, type, RemoteList = false)
    {
        return this.hub.getHUBDevices(oAuth2Client, type, RemoteList);
    }

    async getScenes(oAuth2Client)
    {
        return this.hub.getScenes(oAuth2Client);
    }

    async getDeviceData(oAuth2Client, deviceId)
    {
        return this.hub.getDeviceData(oAuth2Client, deviceId);
    }

    async setDeviceData(oAuth2Client, deviceId, body)
    {
        return this.hub.setDeviceData(oAuth2Client, deviceId, body);
    }

    async GetURL(url)
    {
        return this.hub.GetURL(url);
    }

    async PostURL(url, body)
    {
        return this.hub.PostURL(url, body);
    }

    // async onPair(session)
    // {
    //     const oldAPICode = this.homey.app.BearerToken;
    //     let device = {};
    //     session.setHandler('list_devices', async () =>
    //     {
    //         try
    //         {
    //             const devices = await this.onPairListDevices();
    //             this.homey.settings.set('BearerToken', this.homey.app.BearerToken);
    //             return devices;
    //         }
    //         catch (err)
    //         {
    //             this.homey.app.BearerToken = oldAPICode;
    //             throw new Error(err.message);
    //         }
    //     });

    //     session.setHandler('list_devices_selection', async data =>
    //     {
    //         // User selected a device so cache the information required to validate it when the credentials are set
    //         this.log('list_devices_selection: ', data);
    //         device = data[0];
    //     });

    //     session.setHandler('api_code_setup', async () =>
    //     {
    //         return this.homey.app.BearerToken;
    //     });

    //     session.setHandler('api_connection', async data =>
    //     {
    //         if (data.api_token)
    //         {
    //             this.homey.app.BearerToken = data.api_token;
    //             return true;
    //         }

    //         return false;
    //     });

    //     session.setHandler('set_buttons', async data =>
    //     {
    //         // Creat the full device descriptor
    //         const capabilities = [];
    //         const capabilitiesOptions = {};
    //         const settings = {};

    //         for (let i = 0; i < 12; i++)
    //         {
    //             if (data.buttons[i])
    //             {
    //                 settings[`button${i}`] = data.buttons[i];
    //                 capabilities.push(`button.b${i}`);
    //                 capabilitiesOptions[`button.b${i}`] = {};
    //                 capabilitiesOptions[`button.b${i}`].title = { en: data.buttons[i] };
    //             }
    //         }

    //         device.capabilities = capabilities;
    //         device.capabilitiesOptions = capabilitiesOptions;
    //         device.settings = settings;
    //         this.log(JSON.stringify(device, null, 2));
    //         return device;
    //     });
    // }

    // async onRepair(session, device)
    // {
    //     // Argument socket is an EventEmitter, similar to Driver.onPair
    //     // Argument device is a Homey.Device that's being repaired

    //     session.setHandler('api_code_setup', async () =>
    //     {
    //         return this.homey.app.BearerToken;
    //     });

    //     session.setHandler('api_connection', async data =>
    //     {
    //         if (data.api_token)
    //         {
    //             this.homey.app.BearerToken = data.api_token;
    //             if (device.getHubDeviceValues)
    //             {
    //                 await device.getHubDeviceValues();
    //                 if (device.getAvailable())
    //                 {
    //                     this.homey.settings.set('BearerToken', this.homey.app.BearerToken);
    //                 }
    //             }
    //             return true;
    //         }

    //         return false;
    //     });

    //     session.setHandler('get_buttons', async () =>
    //     {
    //         return device.getButtons();
    //     });

    //     session.setHandler('set_buttons', async data =>
    //     {
    //         await device.setButtons(data.buttons, true);
    //         return true;
    //     });
    // }

}

module.exports = HubDriver;
