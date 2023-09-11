/* jslint node: true */

'use strict';

const BLEDriver = require('../ble_driver');

class BLECurtainDriver extends BLEDriver
{

    /**
     * onInit is called when the driver is initialized.
     */
    async onInit()
    {
        super.onInit();
        this.light_level_changedTrigger = this.homey.flow.getDeviceTriggerCard('light_level_changed');

        this.log('BLECurtainDriver has been initialized');
    }

    /**
     * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
     * This should return an array with the data of devices that are available for pairing.
     */
    onPairListDevices()
    {
        return this.getBLEDevices('c');
    }

    async triggerLightLevelChanged(device, tokens, state)
    {
        this.light_level_changedTrigger.trigger(device, tokens, state).catch(this.error);
    }

}

module.exports = BLECurtainDriver;
