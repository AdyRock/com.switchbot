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
        this.diagLog = "";

        // if (process.env.DEBUG === '1')
        // {
        //     this.homey.settings.set('debugMode', true);
        // }
        //else
        {
            this.homey.settings.set('debugMode', false);
        }

        this.BearerToken = this.homey.settings.get('BearerToken');

        if (this.homey.settings.get('pollInterval') < MINIMUM_POLL_INTERVAL)
        {
            this.homey.settings.set('pollInterval', MINIMUM_POLL_INTERVAL);
        }

        this.log("Switchbot has started with Key: " + this.BearerToken + " Polling every " + this.homey.settings.get('pollInterval') + " seconds");

        // Callback for app settings changed
        this.homey.settings.on('set', async function(setting)
        {
            this.homey.app.updateLog("Setting " + setting + " has changed.");

            if (setting === 'BearerToken')
            {
                this.homey.app.BearerToken = this.homey.settings.get('BearerToken');
            }

            if (setting === 'pollInterval')
            {
            }
        });

        this.updateLog('************** App has initialised. ***************');
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
        if (this.homey.settings.get('logEnabled'))
        {
            console.log(newMessage);
            this.diagLog += "* ";
            this.diagLog += newMessage;
            this.diagLog += "\r\n";
            if (this.diagLog.length > 60000)
            {
                this.diagLog = this.diagLog.substr(this.diagLog.length - 60000);
            }
            this.homey.api.realtime('com.switchbot.logupdated', { 'log': this.diagLog });
        }
    }
}

module.exports = MyApp;