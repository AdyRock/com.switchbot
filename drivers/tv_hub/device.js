/*jslint node: true */
'use strict';

const Homey = require('homey');

class TVHubDevice extends Homey.Device
{
    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        this.log('TVHubDevice has been initialized');
        this.registerCapabilityListener('power_on', this.onCapabilityPowerOn.bind(this));
        this.registerCapabilityListener('power_off', this.onCapabilityPowerOff.bind(this));
        this.registerCapabilityListener('volume_up', this.onCapabilityVolumeUp.bind(this));
        this.registerCapabilityListener('volume_down', this.onCapabilityVolumeDown.bind(this));
        this.registerCapabilityListener('channel_up', this.onCapabilityChannelUp.bind(this));
        this.registerCapabilityListener('channel_down', this.onCapabilityChannelDown.bind(this));
    }

    async onCapabilityPowerOn(value, opts)
    {
        return this._operateDevice('turnOn');
    }

    async onCapabilityPowerOff(value, opts)
    {
        return this._operateDevice('turnOff');
    }

    async onCapabilityVolumeUp(value, opts)
    {
        return this._operateDevice('volumeAdd');
    }

    async onCapabilityVolumeDown(value, opts)
    {
        return this._operateDevice('volumeSub');
    }

    async onCapabilityChannelUp(value, opts)
    {
        return this._operateDevice('channelAdd');
    }

    async onCapabilityChannelDown(value, opts)
    {
        return this._operateDevice('channelSub');
    }

    async _operateDevice(command)
    {
        let data = {
            "command": command,
            "parameter": "default",
            "commandType": "command"
        };

        const dd = this.getData();

        return this.driver.setDeviceData(dd.id, data);
    }
}

module.exports = TVHubDevice;