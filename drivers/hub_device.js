/*jslint node: true */
'use strict';

const Homey = require('homey');

class HubDevice extends Homey.Device
{

    async onCapabilityCommand(command, value, opts)
    {
        return this._operateDevice(command);
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