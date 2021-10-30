/* jslint node: true */

'use strict';

module.exports = {
    async getLog({ homey, query })
    {
        return homey.app.diagLog;
    },
    async getDetect({ homey, query })
    {
        return homey.app.detectedDevices;
    },
    async clearLog({ homey, query })
    {
        homey.app.diagLog = '';
        return 'OK';
    },
    async SendDeviceLog({ homey, query })
    {
        return homey.app.sendLog('deviceLog');
    },
    async SendInfoLog({ homey, query })
    {
        return homey.app.sendLog('infoLog');
    },
    async newData({ homey, body })
    {
        if (homey.app.BLEHub)
        {
            homey.app.BLEHub.newBLEHubData(body);
        }
        return 'OK';
    },
    async requestDeviceStatus({ homey, query })
    {
        const retval = await homey.app.getDeviceStatus(query);
        return JSON.stringify(retval, null, 2);
    },
};
