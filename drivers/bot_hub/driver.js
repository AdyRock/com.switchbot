/*jslint node: true */
'use strict';

const Homey = require('homey');
const HubDriver = require('../hub_driver');

class HubBotDriver extends HubDriver
{
    /**
     * onInit is called when the driver is initialized.
     */
    async onInit()
    {
        super.onInit();
        this.log('HubBotDriver has been initialized');
    }

    /**
     * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
     * This should return an array with the data of devices that are available for pairing.
     */
    async onPairListDevices()
    {
        return this.getHUBDevices('Bot');
    }
}

module.exports = HubBotDriver;