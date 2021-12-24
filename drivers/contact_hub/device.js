/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class ContactHubDevice extends HubDevice
{

    /**
     * onOAuth2Init is called when the device is initialized.
     */
    async onOAuth2Init()
    {
        await super.onOAuth2Init();
        this.log('ContactHubDevice has been initialising');
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded()
    {
        this.log('ContactHubDevice has been added');
    }

    /**
     * onRenamed is called when the user updates the device's name.
     * This method can be used this to synchronise the name to the device.
     * @param {string} name The new name
     */
    async onRenamed(name)
    {
        this.log('ContactHubDevice was renamed');
    }

    async getHubDeviceValues()
    {
        try
        {
            const data = await this._getHubDeviceValues();
            if (data)
            {
                this.setAvailable();

                this.setCapabilityValue('alarm_motion', data.moveDetected).catch(this.error);
                this.setCapabilityValue('alarm_contact', data.openState === 'open').catch(this.error);
                this.setCapabilityValue('alarm_contact.left_open', data.openState === 'timeOutNotClose').catch(this.error);

                const bright = (data.brightness === 'bright');
                if (this.getCapabilityValue('bright') !== bright)
                {
                    this.setCapabilityValue('bright', bright).catch(this.error);
                    this.driver.bright_changed(this, bright);
                }
            }
        }
        catch (err)
        {
            this.log('getHubDeviceValues: ', err);
            this.setUnavailable(err.message);
        }
    }

}

module.exports = ContactHubDevice;
