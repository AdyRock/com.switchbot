/*jslint node: true */
'use strict';

const Homey = require('homey');

class SmartFanHubDevice extends Homey.Device
{
    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        this.log('SmartFanHubDevice has been initialising');

        try
        {
            this.getHubDeviceValues();
        }
        catch(err)
        {
            this.setUnavailable(err.message);
        }
        this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
        this.registerMultipleCapabilityListener(['smart_fan_mode', 'smart_fan_speed', 'smart_fan_shake_range'], this.onCapabilityFanSettings.bind(this));

    }

    // this method is called when the Homey device switches the device on or off
    async onCapabilityOnOff(value, opts)
    {
        let command = value ? "turnOn" : "turnOff";

        return this.sendCommand(command, 'default');
    }

    // this method is called when the Homey smart fan device has requested a change
    async onCapabilityFanSettings(valueOj, optsObj)
    {
        let mode = this.getCapabilityValue('smart_fan_mode');
        let speed = this.getCapabilityValue('smart_fan_speed');
        let shake = this.getCapabilityValue('smart_fan_shake_range');

        if (valueOj.fan_mode)
        {
            // Mode is true
            mode = valueOj.fan_mode;
        }

        if (valueOj.fan_speed)
        {
            // The efficiency has changed
            speed = valueOj.fan_speed;
        }

        if (valueOj.shake_range)
        {
            // mode must have been false so get the last efficiency
            shake = valueOj.shake_range;
        }

        let parameters = `on,${mode},${speed},${shake}`;
        return await this.sendCommand('setAllStatus', parameters);
    }

    async sendCommand(command, parameter)
    {
        let data = {
            "command": command,
            "parameter": parameter,
            "commandType": "command"
        };

        const dd = this.getData();
        return this.driver.setDeviceData(dd.id, data);
    }

    async getHubDeviceValues()
    {
        const dd = this.getData();

        try
        {
            let data = await this.driver.getDeviceData(dd.id);
            if (data)
            {
                this.setAvailable();
                this.setCapabilityValue('onoff', data.power == 'on').catch(this.error);
                this.setCapabilityValue('smart_fan_mode', data.mode).catch(this.error);
                this.setCapabilityValue('smart_fan_speed', data.speed).catch(this.error);
                this.setCapabilityValue('smart_fan_shake_range', data.shakeRange).catch(this.error);
            }
        }
        catch(err)
        {
            this.log('getHubDeviceValues: ', err);
            this.setUnavailable(err.message);

        }
    }
}

module.exports = SmartFanHubDevice;