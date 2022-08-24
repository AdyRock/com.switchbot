/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class ContactHubDevice extends HubDevice
{

    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        await super.onInit();
        if (!this.hasCapability('direction'))
        {
            this.addCapability('direction');
        }

        const dd = this.getData();
        this.homey.app.registerHomeyWebhook(dd.id);

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
                this.homey.app.updateLog(`Contact Hub got:${this.homey.app.varToString(data)}`, 3);

                this.setCapabilityValue('alarm_motion', data.moveDetected).catch(this.error);
                this.setCapabilityValue('alarm_contact', ((data.openState === 'open') || (data.openState === 'timeOutNotClose'))).catch(this.error);
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
            this.homey.app.updateLog(`getHubDeviceValues: : ${this.homey.app.varToString(err)}`, 0);
            this.setUnavailable(err.message);
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
                this.setCapabilityValue('alarm_contact', message.context.openState === 'open').catch(this.error);
                if (message.context.openState === 'open')
                {
                    this.setCapabilityValue('direction', message.context.doorMode === 'OUT_DOOR').catch(this.error);
                    this.driver.direction_changed(this, message.context.doorMode === 'OUT_DOOR');
                }
                else
                {
                    this.setCapabilityValue('direction', null).catch(this.error);
                    this.setCapabilityValue('alarm_contact.left_open', false).catch(this.error);
                }
            }
        }
        catch (err)
        {
            this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
        }
    }

}

module.exports = ContactHubDevice;
