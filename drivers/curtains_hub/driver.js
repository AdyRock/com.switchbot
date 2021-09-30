/*jslint node: true */
'use strict';

const Homey = require('homey');
const HubDriver = require('../hub_driver');

class HubCurtainDriver extends HubDriver
{
    /**
     * onInit is called when the driver is initialized.
     */
    async onInit()
    {
        super.onInit();
        this.log('HubCurtainDriver has been initialized');
    }

    async onPairListDevices()
    {
        return this.getHUBDevices('Curtain');
    }
}

module.exports = HubCurtainDriver;