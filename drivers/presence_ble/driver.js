/* jslint node: true */

'use strict';

const BLEDriver = require('../ble_driver');

class BLEPresenceDriver extends BLEDriver
{

    /**
     * onInit is called when the driver is initialized.
     */
    async onInit()
    {
        super.onInit();
        this.log('BLEPresenceDriver has been initialized');

        // Device Triggers
        this.bright_changed_trigger = this.homey.flow.getDeviceTriggerCard('bright_changed');
    }

    bright_changed(device, bright)
    {
        const tokens = {
            bright,
        };

        this.bright_changed_trigger
            .trigger(device, tokens, {})
            .catch(this.error);
    }

    /**
     * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
     * This should return an array with the data of devices that are available for pairing.
     */
    onPairListDevices()
    {
        return this.getBLEDevices('P');
    }

}

module.exports = BLEPresenceDriver;
