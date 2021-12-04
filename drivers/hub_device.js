/* jslint node: true */

'use strict';

const Homey = require('homey');

class HubDevice extends Homey.Device
{

    async onCapabilityCommand(command, value, opts)
    {
        return this._operateDevice(command);
    }

    async _operateDevice(command, parameter = 'default')
    {
        const data = {
            command,
            parameter,
            commandType: 'command',
        };

        const dd = this.getData();

        return this.driver.setDeviceData(dd.id, data);
    }

    async _operateRemote(command)
    {
        const data = {
            command,
            parameter: 'default',
            commandType: 'customize',
        };

        const dd = this.getData();

        return this.driver.setDeviceData(dd.id, data);
    }

}

module.exports = HubDevice;
