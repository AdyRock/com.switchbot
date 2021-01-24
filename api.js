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
        homey.app.diagLog = "";
        return 'OK';
    }
};