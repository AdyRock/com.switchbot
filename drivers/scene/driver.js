'use strict';

const { Driver } = require('homey');
const HubDriver = require('../hub_driver');

class MyDriver extends HubDriver
{
    /**
     * onInit is called when the driver is initialized.
     */
    async onInit()
    {
        this.log('MyDriver has been initialized');

        const startSceneAction = this.homey.flow.getActionCard('start_scene');
        startSceneAction
            .registerRunListener(async (args, state) =>
            {
                this.log("activate_instant_mode");
                return args.device.onCapabilityStartScene();
            });
    }

    /**
     * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
     * This should return an array with the data of devices that are available for pairing.
     */
     async onPairListDevices()
     {
         return this.getHUBScenes();
     }
 
     async getHUBScenes()
     {
        //https://api.switch-bot.com/v1.0/scenes
        const url = "scenes";
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
            for (const device of searchData)
            {
                this.homey.app.updateLog("Found device: ");
                this.homey.app.updateLog(device);

                let data = {};
                data = {
                    "id": device.sceneId,
                };

                // Add this device to the table
                devices.push(
                    {
                        "name": device.sceneName,
                        data
                    });
            }
            return devices;
        }
        else
        {
            this.homey.app.updateLog("Getting API Key returned NULL");
            throw (new Error("HTTPS Error: Nothing returned"));
        }
     }
 }

module.exports = MyDriver;