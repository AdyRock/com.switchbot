/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class HubPresenceDriver extends HubDriver
{

    /**
     * onInit is called when the driver is initialized.
     */
    async onInit()
    {
        super.onInit();
        this.log('HubPresenceDriver has been initialized');

        // Device Triggers
        this.bright_changed_trigger = this.homey.flow.getDeviceTriggerCard('bright_changed');
    }

    bright_changed(device, bright)
    {
        const tokens = {
            bright,
        };

        this.bright_changed_trigger.trigger(device, tokens)
            .catch(this.error);
    }

    async onPairListDevices()
    {
        return this.getHUBDevices('Motion Sensor');
    }

}

module.exports = HubPresenceDriver;
