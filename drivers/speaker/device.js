/*jslint node: true */
'use strict';

const Homey = require('homey');

class SpeakerHubDevice extends Homey.Device
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

    async onCapabilityPowerOn(value, opts)
    {
        return this._operateDevice('turnOn');
    }

    async onCapabilityPowerOff(value, opts)
    {
        return this._operateDevice('turnOff');
    }

    async onCapabilityMute(value, opts)
    {
        if (this.cancelMute)
        {
            clearTimeout(this.cancelMute);
        }
        let result =  this._operateDevice('setMute');
        if (value)
        {
            this.cancelMute = setTimeout(() => this.setCapabilityValue('volume_mute', false), 1000);
        }
        return result;
    }

    async onCapabilityVolumeUp(value, opts)
    {
        return this._operateDevice('volumeAdd');
    }

    async onCapabilityVolumeDown(value, opts)
    {
        return this._operateDevice('volumeSub');
    }
    async onCapabilityPlay(value, opts)
    {
        return this._operateDevice('Play');
    }

    async onCapabilityPause(value, opts)
    {
        return this._operateDevice('Pause');
    }

    async onCapabilityStop(value, opts)
    {
        return this._operateDevice('Stop');
    }

    async onCapabilityPrev(value, opts)
    {
        return this._operateDevice('Previous');
    }

    async onCapabilityNext(value, opts)
    {
        return this._operateDevice('Next');
    }

    async onCapabilityRewind(value, opts)
    {
        return this._operateDevice('Rewind');
    }

    async onCapabilityForward(value, opts)
    {
        return this._operateDevice('FastForward');
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

module.exports = SpeakerHubDevice;