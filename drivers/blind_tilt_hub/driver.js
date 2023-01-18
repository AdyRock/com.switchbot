/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class HubBlindTiltDriver extends HubDriver
{

    /**
     * onOAuth2Init is called when the driver is initialized.
     */
    async onOAuth2Init()
    {
        super.onOAuth2Init();

        // Device Triggers
        this.windowcoverings_tilt_set_changed = this.homey.flow.getDeviceTriggerCard('windowcoverings_tilt_set_changed');

        this.log('HubBlindTiltDriver has been initialized');
    }

    async onPairListDevices({ oAuth2Client })
    {
        return this.getHUBDevices(oAuth2Client, 'Blind Tilt');
    }

}

module.exports = HubBlindTiltDriver;
