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

        if (this.hasCapability('onoff'))
        {
            this.removeCapability('onoff');
            this.addCapability('power_on');
            this.addCapability('power_off');
        }
        
        this.registerMultipleCapabilityListener(['power_on', 'target_temperature', 'aircon_mode', 'aircon_fan_speed'], this.onCapabilityAll.bind(this));
        this.registerCapabilityListener('power_off', this.onCapabilityACPowerOff.bind(this));

        let temp = this.getCapabilityValue('target_temperature');
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

    async onCapabilityACPowerOff(value, opts)
    {
        let temp = this.getCapabilityValue('target_temperature');
        if (temp === null)
        {
            temp = 22;
        }
    
        let mode = this.getCapabilityValue('aircon_mode');
        if (mode === null)
        {
            mode = '1';
        }
        
        let fan = this.getCapabilityValue('aircon_fan_speed');
        if (fan === null)
        {
            fan = '1';
        }

        mode = Number(mode);
        fan = Number(fan);

        let parameters = `${ temp },${ mode },${ fan },off`;
        return this._operateDevice(parameters);
    }

    // this method is called when the Homey device has requested a value change
    async onCapabilityAll(valueOj, optsObj)
    {
        let temp;
        let mode;
        let fan;
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

        mode = Number(mode);
        fan = Number(fan);

        let parameters = `${ temp },${ mode },${ fan },on`;
        return this._operateDevice(parameters);
    }

    async _operateDevice(parameters)
    {
        let data = {
            "command": "setAll",
            "parameter": parameters,
            "commandType": "command"
        };

        const dd = this.getData();

        return this.driver.setDeviceData(dd.id, data);
    }
}

module.exports = AirConHubDevice;