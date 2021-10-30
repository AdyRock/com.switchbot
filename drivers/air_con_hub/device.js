/* jslint node: true */

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

        this.registerMultipleCapabilityListener(['onoff', 'target_temperature', 'aircon_mode', 'aircon_fan_speed'], this.onCapabilityAll.bind(this));
        this.registerCapabilityListener('power_off', this.onCapabilityPowerOff.bind(this));
        this.registerCapabilityListener('power_on', this.onCapabilityPowerOn.bind(this));

        let temp = this.getCapabilityValue('target_temperature');
        if (temp === null)
        {
            this.setCapabilityValue('target_temperature', 21).catch(this.error);
        }

        temp = this.getCapabilityValue('aircon_mode');
        if (temp === null)
        {
            this.setCapabilityValue('aircon_mode', '2').catch(this.error);
        }

        temp = this.getCapabilityValue('aircon_fan_speed');
        if (temp === null)
        {
            this.setCapabilityValue('aircon_fan_speed', '2').catch(this.error);
        }
    }

    async onCapabilityPowerOff(value, opts)
    {
        return this.onCapabilityAll({ power_off: true });
    }

    async onCapabilityPowerOn(value, opts)
    {
        return this.onCapabilityAll({ power_on: true });
    }

    async onCapabilityCommand(command)
    {
        if (command === 'turnOn')
        {
            return this.onCapabilityPowerOn();
        }

            return this.onCapabilityPowerOff();
    }

    // this method is called when the Homey device has requested a value change
    async onCapabilityAll(valueOj, optsObj)
    {
        let temp;
        let mode;
        let fan;
        let onOff = 'on';

        if (valueOj.onoff !== undefined && valueOj.onOff === false)
        {
            onOff = 'off';
        }

        if (valueOj.power_off)
        {
            onOff = 'off';
        }

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
                mode = '2';
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
                fan = '2';
            }
        }

        mode = Number(mode);
        fan = Number(fan);

        const parameters = `${temp},${mode},${fan},${onOff}`;
        return this._operateDevice(parameters);
    }

    async _operateDevice(parameters)
    {
        const data = {
            command: 'setAll',
            parameter: parameters,
            commandType: 'command',
        };

        const dd = this.getData();

        return this.driver.setDeviceData(dd.id, data);
    }

}

module.exports = AirConHubDevice;
