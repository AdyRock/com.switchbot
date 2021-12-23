/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class PresenceHubDevice extends HubDevice
{

    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        await super.onInit();

        this.log('PresenceHubDevice has been initialising');
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded()
    {
        this.log('PresenceHubDevice has been added');
    }

    /**
     * onRenamed is called when the user updates the device's name.
     * This method can be used this to synchronise the name to the device.
     * @param {string} name The new name
     */
    async onRenamed(name)
    {
        this.log('PresenceHubDevice was renamed');
    }

    async getHubDeviceValues()
    {
        const dd = this.getData();

        try
        {
            const data = await this.driver.getDeviceData(dd.id);
            if (data)
            {
                this.setAvailable();

                this.setCapabilityValue('alarm_motion', data.moveDetected).catch(this.error);

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

module.exports = PresenceHubDevice;