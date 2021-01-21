'use strict';
if (process.env.DEBUG === '1')
{
    require('inspector').open(9222, '0.0.0.0', true)
}

const Homey = require('homey');
const MINIMUM_POLL_INTERVAL = 5;

class MyApp extends Homey.App
{
    /**
     * onInit is called when the app is initialized.
     */
    async onInit()
    {
        this.log('SwitchBot has been initialized');

        if (process.env.DEBUG === '1')
        {
            Homey.ManagerSettings.set('debugMode', true);
        }
        else
        {
            Homey.ManagerSettings.set('debugMode', false);
        }

        this.BearerToken = Homey.ManagerSettings.get('BearerToken');

        if (Homey.ManagerSettings.get('pollInterval') < MINIMUM_POLL_INTERVAL)
        {
            Homey.ManagerSettings.set('pollInterval', MINIMUM_POLL_INTERVAL);
        }

        this.log("Switchbot has started with Key: " + this.BearerToken + " Polling every " + Homey.ManagerSettings.get('pollInterval') + " seconds");

        // Callback for app settings changed
        Homey.ManagerSettings.on('set', async function(setting)
        {
            Homey.app.updateLog("Setting " + setting + " has changed.");

            if (setting === 'BearerToken')
            {
                Homey.app.BearerToken = Homey.ManagerSettings.get('BearerToken');
            }

            if (setting === 'pollInterval')
            {
                clearTimeout(Homey.app.timerID);
                if (Homey.app.BearerToken && !Homey.app.timerProcessing)
                {
                    if (Homey.ManagerSettings.get('pollInterval') > 1)
                    {
                        Homey.app.timerID = setTimeout(Homey.app.onPoll, Homey.ManagerSettings.get('pollInterval') * 1000);
                    }
                }
            }
        });

        this.onPoll = this.onPoll.bind(this);

        if (this.BearerToken)
        {
            if (Homey.ManagerSettings.get('pollInterval') > 1)
            {
                this.updateLog("Start Polling");
                this.timerID = setTimeout(this.onPoll, 10000);
            }
        }

        this.updateLog('************** App has initialised. ***************');
    }

    async onPoll()
    {
        Homey.app.timerProcessing = true;
        const promises = [];
        try
        {
            // Fetch the list of drivers for this app
            const drivers = Homey.ManagerDrivers.getDrivers();
            for (const driver in drivers)
            {
                let devices = Homey.ManagerDrivers.getDriver(driver).getDevices();
                for (var i = 0; i < devices.length; i++)
                {
                    let device = devices[i];
                    if (device.getDeviceValues)
                    {
                        promises.push(device.getDeviceValues());
                    }
                }
            }

            await Promise.all(promises);

        }
        catch (err)
        {
            Homey.app.updateLog("Polling Error: " + this.varToString(err));
        }

        var nextInterval = Number(Homey.ManagerSettings.get('pollInterval')) * 1000;
        if (nextInterval < 1000)
        {
            nextInterval = 5000;
        }
        Homey.app.updateLog("Next Interval = " + nextInterval, true);
        Homey.app.timerID = setTimeout(Homey.app.onPoll, nextInterval);
        Homey.app.timerProcessing = false;
    }

    varToString(source)
    {
        try
        {
            if (source === null)
            {
                return "null";
            }
            if (source === undefined)
            {
                return "undefined";
            }
            if (source instanceof Error)
            {
                let stack = source.stack.replace('/\\n/g', '\n');
                return source.message + '\n' + stack;
            }
            if (typeof(source) === "object")
            {
                const getCircularReplacer = () =>
                {
                    const seen = new WeakSet();
                    return (key, value) =>
                    {
                        if (typeof value === "object" && value !== null)
                        {
                            if (seen.has(value))
                            {
                                return;
                            }
                            seen.add(value);
                        }
                        return value;
                    };
                };

                return JSON.stringify(source, getCircularReplacer(), 2);
            }
            if (typeof(source) === "string")
            {
                return source;
            }
        }
        catch (err)
        {
            this.log("VarToString Erro: ", err);
        }

        return source.toString();
    }

    updateLog(newMessage)
    {
        if (Homey.ManagerSettings.get('logEnabled'))
        {
            console.log(newMessage);
            this.diagLog += "* ";
            this.diagLog += newMessage;
            this.diagLog += "\r\n";
            if (this.diagLog.length > 60000)
            {
                this.diagLog = this.diagLog.substr(this.diagLog.length - 60000);
            }
            Homey.ManagerApi.realtime('com.switchbot.logupdated', { 'log': this.diagLog });
        }
    }
}

module.exports = MyApp;