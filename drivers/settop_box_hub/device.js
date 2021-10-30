/* jslint node: true */

'use strict';

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
        this.registerCapabilityListener('power_on', this.onCapabilityCommand.bind(this, 'turnOn'));
        this.registerCapabilityListener('power_off', this.onCapabilityCommand.bind(this, 'turnOff'));
        this.registerCapabilityListener('volume_up', this.onCapabilityCommand.bind(this, 'volumeAdd'));
        this.registerCapabilityListener('volume_down', this.onCapabilityCommand.bind(this, 'volumeSub'));
        this.registerCapabilityListener('volume_mute', this.onCapabilityCommand.bind(this, 'setMute'));
        this.registerCapabilityListener('channel_up', this.onCapabilityCommand.bind(this, 'channelAdd'));
        this.registerCapabilityListener('channel_down', this.onCapabilityCommand.bind(this, 'channelSub'));

        this.setCapabilityValue('volume_mute', false).catch(this.error);
    }

}

module.exports = STBHubDevice;
