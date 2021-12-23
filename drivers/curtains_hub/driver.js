/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class HubCurtainDriver extends HubDriver
{

    /**
     * onOAuth2Init is called when the driver is initialized.
     */
    async onOAuth2Init()
    {
        super.onOAuth2Init();
        this.log('HubCurtainDriver has been initialized');
    }

    async onPairListDevices({ oAuth2Client })
    {
        return this.getHUBDevices(oAuth2Client, 'Curtain');
    }

}

module.exports = HubCurtainDriver;
