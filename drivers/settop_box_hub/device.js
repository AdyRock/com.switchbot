/*jslint node: true */
'use strict';

const Homey = require('homey');
const HubDevice = require('../hub_device');

class STBHubDevice extends HubDevice
{
    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        this.log('STBHubDevice has been initialized');
        if (!this.hasCapability('volume_mute'))
        {
            this.addCapability('volume_mute');
        }
        this.registerCapabilityListener('power_on', this.onCapabilityPowerOn.bind(this));
        this.registerCapabilityListener('power_off', this.onCapabilityPowerOff.bind(this));
        this.registerCapabilityListener('volume_up', this.onCapabilityVolumeUp.bind(this));
        this.registerCapabilityListener('volume_down', this.onCapabilityVolumeDown.bind(this));
        this.registerCapabilityListener('channel_up', this.onCapabilityChannelUp.bind(this));
        this.registerCapabilityListener('channel_down', this.onCapabilityChannelDown.bind(this));
        this.registerCapabilityListener('volume_mute', this.onCapabilityMute.bind(this));

        this.setCapabilityValue('volume_mute', false);
    }
}

module.exports = STBHubDevice;