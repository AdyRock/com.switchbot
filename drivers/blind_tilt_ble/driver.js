/* jslint node: true */

'use strict';

const BLEDriver = require('../ble_driver');

class BLEBlindTiltDriver extends BLEDriver
{

    /**
     * onInit is called when the driver is initialized.
     */
    async onInit()
    {
        super.onInit();
        this.log('BLEBlindTiltDriver has been initialized');
    }

    /**
     * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
     * This should return an array with the data of devices that are available for pairing.
     */
    onPairListDevices()
    {
        return this.getBLEDevices('x');
    }

}

module.exports = BLEBlindTiltDriver;
