/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class HubCustomRemoteDriver extends HubDriver
{

    /**
     * onOAuth2Init is called when the driver is initialized.
     */
    async onOAuth2Init()
    {
        super.onOAuth2Init();
        this.log('HubCustomRemoteDriver has been initialized');
    }

    /**
     * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
     * This should return an array with the data of devices that are available for pairing.
     */
    async onPairListDevices({ oAuth2Client })
    {
        return this.getHUBDevices(oAuth2Client, 'Others', true);
    }

    async onPair(session)
    {
        let device = {};

        session.setHandler('list_devices_selection', async data =>
        {
            // User selected a device so cache the information required to validate it when the credentials are set
            this.log('list_devices_selection: ', data);
            device = data[0];
        });

        session.setHandler('set_buttons', async data =>
        {
            // Creat the full device descriptor
            const capabilities = [];
            const capabilitiesOptions = {};
            const settings = {};

            for (let i = 0; i < 12; i++)
            {
                if (data.buttons[i])
                {
                    settings[`button${i}`] = data.buttons[i];
                    capabilities.push(`button.b${i}`);
                    capabilitiesOptions[`button.b${i}`] = {};
                    capabilitiesOptions[`button.b${i}`].title = { en: data.buttons[i] };
                }
            }

            device.capabilities = capabilities;
            device.capabilitiesOptions = capabilitiesOptions;
            device.settings = settings;
            this.log(JSON.stringify(device, null, 2));
            return device;
        });
    }

}

module.exports = HubCustomRemoteDriver;
