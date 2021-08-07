/*jslint node: true */
'use strict';

const Homey = require('homey');
const HubDevice = require('../hub_device');

class SpeakerHubDevice extends HubDevice
{
    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        this.log('SpeakerHubDevice has been initialized');
        this.registerCapabilityListener('power_on', this.onCapabilityPowerOn.bind(this));
        this.registerCapabilityListener('power_off', this.onCapabilityPowerOff.bind(this));
        this.registerCapabilityListener('volume_up', this.onCapabilityVolumeUp.bind(this));
        this.registerCapabilityListener('volume_down', this.onCapabilityVolumeDown.bind(this));
        this.registerCapabilityListener('volume_mute', this.onCapabilityMute.bind(this));
        this.registerCapabilityListener('play', this.onCapabilityPlay.bind(this));
        this.registerCapabilityListener('pause', this.onCapabilityPause.bind(this));
        this.registerCapabilityListener('stop', this.onCapabilityStop.bind(this));
        this.registerCapabilityListener('prev', this.onCapabilityPrev.bind(this));
        this.registerCapabilityListener('next', this.onCapabilityNext.bind(this));
        this.registerCapabilityListener('rewind', this.onCapabilityRewind.bind(this));
        this.registerCapabilityListener('forward', this.onCapabilityForward.bind(this));

        this.setCapabilityValue('volume_mute', false);
    }
}

module.exports = SpeakerHubDevice;