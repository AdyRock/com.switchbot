/*jslint node: true */
'use strict';

const Homey = require('homey');

class HubDevice extends Homey.Device
{

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
        if (value)
        {
            await this._operateDevice('setMute');
            this.cancelMute = setTimeout(() => this.setCapabilityValue('volume_mute', false), 1000);
        }

        return true;
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

    async _operateDevice(command, parameter = "default")
    {
        let data = {
            "command": command,
            "parameter": parameter,
            "commandType": "command"
        };

        const dd = this.getData();

        return this.driver.setDeviceData(dd.id, data);
    }}

module.exports = HubDevice;