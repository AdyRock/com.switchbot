/*jslint node: true */
'use strict';

const Homey = require('homey');

class AirConHubDevice extends Homey.Device
{
    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        this.log('AirConHubDevice has been initialized');
        this.registerMultipleCapabilityListener(['onoff', 'target_temperature', 'aircon_mode', 'aircon_fan_speed'], this.onCapabilityAll.bind(this));

        let temp = this.getCapabilityValue('onoff');
        if (temp === null)
        {
            this.setCapabilityValue('onoff', false);
        }
        
        temp = this.getCapabilityValue('target_temperature');
        if (temp === null)
        {
            this.setCapabilityValue('target_temperature', 21);
        }
        
        temp = this.getCapabilityValue('aircon_mode');
        if (temp === null)
        {
            this.setCapabilityValue('aircon_mode', '1');
        }

        temp = this.getCapabilityValue('aircon_fan_speed');
        if (temp === null)
        {
            this.setCapabilityValue('aircon_fan_speed', '1');
        }
    }

    // this method is called when the Homey device has requested a position change ( 0 to 1)
    async onCapabilityAll(valueOj, optsObj)
    {
        let temp;
        let mode;
        let fan;
        let power;
        if (valueOj.target_temperature)
        {
            temp = valueOj.target_temperature;
        }
        else
        {
            temp = this.getCapabilityValue('target_temperature');
            if (temp === null)
            {
                temp = 22;
            }
        }

        if (valueOj.aircon_mode)
        {
            mode = valueOj.aircon_mode;
        }
        else
        {
            mode = this.getCapabilityValue('aircon_mode');
            if (mode === null)
            {
                mode = '1';
            }
        }

        if (valueOj.aircon_fan_speed)
        {
            fan = valueOj.aircon_fan_speed;
        }
        else
        {
            fan = this.getCapabilityValue('aircon_fan_speed');
            if (fan === null)
            {
                fan = '1';
            }
        }

        if (valueOj.onoff)
        {
            power = valueOj.onoff;
        }
        else
        {
            power = this.getCapabilityValue('onoff');
            if (power === null)
            {
                power = true;
            }
        }

        power = power ? "on" : "off";
        mode = Number(mode);
        fan = Number(fan);

        let command = `${ temp },${ mode },${ fan },${ power }`;
        return this._operateDevice(command);
    }

    async _operateDevice(command)
    {
        let data = {
            "command": command,
            "parameter": "setAll",
            "commandType": "command"
        };

        const dd = this.getData();

        return this.driver.setDeviceData(dd.id, data);
    }
}

module.exports = AirConHubDevice;