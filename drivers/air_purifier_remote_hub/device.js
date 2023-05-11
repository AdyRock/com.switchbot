/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class AirPurifierDevice extends HubDevice
{

    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        await super.onInit();

        this.registerCapabilityListener('power_on', this.onCapabilityCommand.bind(this, 'turnOn'));
        this.registerCapabilityListener('power_off', this.onCapabilityCommand.bind(this, 'turnOff'));
        this.registerCapabilityListener('fan_speed_low', this.onCapabilityCommand.bind(this, 'lowSpeed'));
        this.registerCapabilityListener('fan_speed_middle', this.onCapabilityCommand.bind(this, 'middleSpeed'));
        this.registerCapabilityListener('fan_speed_high', this.onCapabilityCommand.bind(this, 'highSpeed'));

        this.log('AirPurifierDevice has been initialising');
    }
}

module.exports = AirPurifierDevice;
