/*jslint node: true */
'use strict';

const Homey = require('homey');

class HumidityHubDevice extends Homey.Device
{
    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        this.log('HumidityHubDevice has been initialising');

        this.getHubDeviceValues();
        this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
        this.registerMultipleCapabilityListener(['nebulization_mode', 'nebulization_efficiency'], this.onCapabilityNebulization.bind(this));

    }

    // this method is called when the Homey device switches the device on or off
    async onCapabilityOnOff(value, opts)
    {
        let command = value ? "turnOn" : "turnOff";

        return this.sendCommand(command, 'default');
    }

    // this method is called when the Homey device has requested a position change ( 0 to 1)
    async onCapabilityNebulization(valueOj, optsObj)
    {
        let mode = null;
        if (valueOj.nebulization_mode)
        {
            // Mode is true
            mode = 'auto';
        }
        else if (valueOj.nebulization_efficiency)
        {
            // The efficiency has changed
            mode = valueOj.nebulization_efficiency;

            if (this.getCapabilityValue('nebulization_mode'))
            {
                setTimeout(() => this.setCapabilityValue('nebulization_mode', false), 1000);
            }
        }
        else
        {
            // mode must have been false so get the last efficiency
            mode = this.getCapabilityValue('nebulization_efficiency');
        }

        return await this.sendCommand('setMode', mode);
    }

    async sendCommand(command, parameter)
    {
        this.setCapabilityValue('position', null);
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
                this.setCapabilityValue('onoff', data.power);
                this.setCapabilityValue('nebulization_efficiency', data.nebulizationEfficiency);
                this.setCapabilityValue('nebulization_mode', data.auto);
                this.setCapabilityValue('measure_temperature', data.temperature);
                this.setCapabilityValue('measure_humidity', data.humidity);
            }
        }
        catch(err)
        {
            this.log('getHubDeviceValues: ', err);
        }
    }
}

module.exports = HumidityHubDevice;