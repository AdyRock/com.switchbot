/*jslint node: true */
'use strict';

const Homey = require('homey');
const HubDriver = require('../hub_driver');

class HubTVDriver extends HubDriver
{
    /**
     * onInit is called when the driver is initialized.
     */
    async onInit()
    {
        super.onInit();
        this.log('HubTVDriver has been initialized');

        const onAction = this.homey.flow.getActionCard('on');
        onAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityPowerOn();
            });

        const offAction = this.homey.flow.getActionCard('off');
        offAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityPowerOff();
            });
    }

    /**
     * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
     * This should return an array with the data of devices that are available for pairing.
     */
    async onPairListDevices()
    {
        return this.getHUBDevices('TV', true);
    }
}

module.exports = HubTVDriver;