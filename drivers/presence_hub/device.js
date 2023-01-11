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

        const dd = this.getData();
        this.homey.app.registerHomeyWebhook(dd.id);

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
        try
        {
            const data = await this._getHubDeviceValues();
            if (data)
            {
                this.setAvailable();
                this.homey.app.updateLog(`Presence Hub got: ${this.homey.app.varToString(data)}`, 3);

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
            this.homey.app.updateLog(`Presence getHubDeviceValues: ${this.homey.app.varToString(err.message)}`);
            this.setWarning(err.message);
        }
    }

    async processWebhookMessage(message)
    {
        try
        {
            const dd = this.getData();
            if (dd.id === message.context.deviceMac)
            {
                // message is for this device
                this.setCapabilityValue('alarm_motion', message.context.detectionState === 'DETECTED').catch(this.error);
            }
        }
        catch (err)
        {
            this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
        }
    }

}

module.exports = PresenceHubDevice;
