/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class HubCameraDriver extends HubDriver
{

    /**
     * onOAuth2Init is called when the driver is initialized.
     */
    async onOAuth2Init()
    {
        super.onOAuth2Init();
        this.log('HubPresenceDriver has been initialized');
    }

    async onPairListDevices({ oAuth2Client })
    {
        return this.getHUBDevices(oAuth2Client, ['Indoor Cam', 'Pan/Tilt Cam']);
    }

}

module.exports = HubCameraDriver;
