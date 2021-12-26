/* jslint node: true */

'use strict';

if (process.env.DEBUG === '1')
{
    // eslint-disable-next-line node/no-unsupported-features/node-builtins, global-require
    require('inspector').open(9222, '0.0.0.0', true);
}

const Homey = require('homey');
const { OAuth2App } = require('homey-oauth2app');
const nodemailer = require('nodemailer');
const HubInterface = require('./lib/hub_interface');
const BLEHubInterface = require('./lib/ble_hub_interface');
const SwitchBotOAuth2Client = require('./lib/SwitchBotOAuth2Client');

const MINIMUM_POLL_INTERVAL = 5; // in Seconds
const BLE_POLLING_INTERVAL = 5000; // in milliSeconds
class MyApp extends OAuth2App
{

    static OAUTH2_CLIENT = SwitchBotOAuth2Client; // Default: OAuth2Client
    static OAUTH2_DEBUG = true; // Default: false
    static OAUTH2_MULTI_SESSION = false; // Default: false
    static OAUTH2_DRIVERS = [
        'contact_hub',
        'air_con_hub',
        'bot_hub',
        'color_bulb_hub',
        'curtains_hub',
        'custom_remote_hub',
        'dvd',
        'fan_hub',
        'humidifier_hub',
        'presence_hub',
        'scene',
        'settop_box_hub',
        'smart_fan_hub',
        'speaker',
        'temperature_hub',
        'tv_hub',
    ]; // Default: all drivers

    /**
     * onInit is called when the app is initialized.
     */
    async onOAuth2Init()
    {
        this.log('SwitchBot has been initialized');
        this.diagLog = '';
        this.homey.app.deviceStatusLog = '';
        this.BearerToken = this.homey.settings.get('BearerToken');

        if (process.env.DEBUG === '1')
        {
            this.homey.settings.set('debugMode', true);
        }
        else
        {
            this.homey.settings.set('debugMode', false);
        }

        this.hub = new HubInterface(this.homey);

        this.homeyHash = await this.homey.cloud.getHomeyId();
        this.homeyHash = this.hashCode(this.homeyHash).toString();

        this.logLevel = this.homey.settings.get('logLevel');
        if (this.logLevel === null)
        {
            this.logLevel = 0;
            this.homey.settings.set('logLevel', this.logLevel);
        }

        // Callback for app settings changed
        this.homey.settings.on('set', async function settingChanged(setting)
        {
            this.homey.app.updateLog(`Setting ${setting} has changed.`);
            if (setting === 'logLevel')
            {
                this.homey.app.logLevel = this.homey.settings.get('logLevel');
            }
        });

        // Set to true to enable use of my BLE hub (WIP)
        this.BLEHub = null;

        try
        {
            this.homeyIP = await this.homey.cloud.getLocalAddress();
            if (this.homeyIP)
            {
                this.BLEHub = new BLEHubInterface(this.homey, this.homeyIP);
            }
        }
        catch (err)
        {
            // Homey cloud or Bridge so no LAN access
            this.homeyIP = null;
        }

        this.onHubPoll = this.onHubPoll.bind(this);
        this.hubDevices = 0;
        this.timerHubID = null;
        // this.timerHubID = this.homey.setTimeout(this.onHubPoll, 10000);

        this.onBLEPoll = this.onBLEPoll.bind(this);
        this.bleDevices = 0;
        this.bleTimerID = null;
        // this.bleTimerID = this.homey.setTimeout(this.onBLEPoll, BLE_POLLING_INTERVAL);

        // Register flow cards

        const operateAction = this.homey.flow.getActionCard('operate_aircon');
        operateAction
            .registerRunListener(async (args, state) =>
            {
                this.log('activate_instant_mode');
                return args.device.onCapabilityAll(args);
            });

        const onAction = this.homey.flow.getActionCard('on');
        onAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityCommand('turnOn');
            });

        const offAction = this.homey.flow.getActionCard('off');
        offAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityCommand('turnOff');
            });

        const muteAction = this.homey.flow.getActionCard('mute');
        muteAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityCommand('mute');
            });

        const playAction = this.homey.flow.getActionCard('play');
        playAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityCommand('play');
            });

        const pauseAction = this.homey.flow.getActionCard('pause');
        pauseAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityCommand('pause');
            });

        const stopAction = this.homey.flow.getActionCard('stop');
        stopAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityCommand('stop');
            });

        const prevAction = this.homey.flow.getActionCard('prev');
        prevAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityCommand('prev');
            });

        const nextAction = this.homey.flow.getActionCard('next');
        nextAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityCommand('next');
            });

        const setChannelAction = this.homey.flow.getActionCard('set_channel');
        setChannelAction
            .registerRunListener(async (args, state) =>
            {
                return args.device._operateDevice('SetChannel', args.channel_number.toString());
            });

        const rewindAction = this.homey.flow.getActionCard('rewind');
        rewindAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityCommand('rewind');
            });

        const forwardAction = this.homey.flow.getActionCard('forward');
        forwardAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityCommand('forward');
            });

        const startSceneAction = this.homey.flow.getActionCard('start_scene');
        startSceneAction
            .registerRunListener(async (args, state) =>
            {
                this.log('activate_instant_mode');
                return args.device.onCapabilityStartScene();
            });

        const runSceneAction = this.homey.flow.getActionCard('run_scene');
        runSceneAction.registerRunListener(async (args, state) =>
        {
            const url = `scenes/${args.scene.data.id}/execute`;
            await this.hub.PostURL(url);
        });
        runSceneAction.registerArgumentAutocompleteListener('scene', async (query, args) =>
        {
            const results = await this.hub.getScenes();

            // filter based on the query
            return results.filter(result =>
            {
                return result.name.toLowerCase().includes(query.toLowerCase());
            });
        });

        const nebulizationModeAction = this.homey.flow.getActionCard('nebulization_mode');
        nebulizationModeAction.registerRunListener(async (args, state) =>
        {
            return args.device.onCapabilityNebulization(args);
        });

        const nebulizationEfficiencyAction = this.homey.flow.getActionCard('nebulization_efficiency');
        nebulizationEfficiencyAction.registerRunListener(async (args, state) =>
        {
            return args.device.onCapabilityNebulization(args);
        });

        const smartFanAction = this.homey.flow.getActionCard('smart_fan_mode');
        smartFanAction.registerRunListener(async (args, state) =>
        {
            return args.device.onCapabilityFanSettings(args);
        });

        const fanSwingAction = this.homey.flow.getActionCard('fan_swing');
        fanSwingAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityCommand('swing');
            });

        const fanLowSpeedAction = this.homey.flow.getActionCard('fan_low_speed');
        fanLowSpeedAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityCommand('lowSpeed');
            });

        const fanMediumSpeedAction = this.homey.flow.getActionCard('fan_medium_speed');
        fanMediumSpeedAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityCommand('middleSpeed');
            });

        const fanHighSpeedAction = this.homey.flow.getActionCard('fan_high_speed');
        fanHighSpeedAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityCommand('highSpeed');
            });

        const sendRemoteCommandAction = this.homey.flow.getActionCard('send_custom_remote_command');
        sendRemoteCommandAction.registerRunListener(async (args, state) =>
        {
            return args.device.onCapabilityButtonPressed(args.command.id);
        });
        sendRemoteCommandAction.registerArgumentAutocompleteListener('command', async (query, args) =>
        {
            const results = await args.device.getButtonList();

            // filter based on the query
            return results.filter(result =>
            {
                return result.name.toLowerCase().includes(query.toLowerCase());
            });
        });

        this.homey.app.updateLog('************** App has initialised. ***************');
    }

    async onUninit()
    {
        this.hub.destroy();
        if (this.BLEHub)
        {
            this.BLEHub.destroy();
        }
    }

    hashCode(s)
    {
        let h = 0;
        for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
        return h;
    }

    varToString(source)
    {
        try
        {
            if (source === null)
            {
                return 'null';
            }
            if (source === undefined)
            {
                return 'undefined';
            }
            if (source instanceof Error)
            {
                const stack = source.stack.replace('/\\n/g', '\n');
                return `${source.message}\n${stack}`;
            }
            if (typeof (source) === 'object')
            {
                const getCircularReplacer = () =>
                {
                    const seen = new WeakSet();
                    return (key, value) =>
                    {
                        if (typeof value === 'object' && value !== null)
                        {
                            if (seen.has(value))
                            {
                                return '';
                            }
                            seen.add(value);
                        }
                        return value;
                    };
                };

                return JSON.stringify(source, getCircularReplacer(), 2);
            }
            if (typeof (source) === 'string')
            {
                return source;
            }
        }
        catch (err)
        {
            this.homey.app.updateLog(`VarToString Error: ${err}`, 0);
        }

        return source.toString();
    }

    updateLogEnabledSetting(logLevel)
    {
        this.homey.app.logLevel = logLevel;
        this.homey.settings.set('logLevel', logLevel);

        const drivers = this.homey.drivers.getDrivers();
        for (const driver of Object.values(drivers))
        {
            const devices = driver.getDevices();
            for (const device of Object.values(devices))
            {
                if (device.updateLogEnabledSetting)
                {
                    device.updateLogEnabledSetting(logLevel);
                }
            }
        }
    }

    updateLog(newMessage, errorLevel = 1)
    {
        const zeroPad = (num, places) => String(num).padStart(places, '0');

        if (errorLevel <= this.homey.app.logLevel)
        {
            this.log(newMessage);

            const nowTime = new Date(Date.now());

            this.diagLog += zeroPad(nowTime.getHours().toString(), 2);
            this.diagLog += ':';
            this.diagLog += zeroPad(nowTime.getMinutes().toString(), 2);
            this.diagLog += ':';
            this.diagLog += zeroPad(nowTime.getSeconds().toString(), 2);
            this.diagLog += '.';
            this.diagLog += zeroPad(nowTime.getMilliseconds().toString(), 3);
            this.diagLog += ': ';

            if (errorLevel === 0)
            {
                this.diagLog += '!!!!!! ';
            }
            else
            {
                this.diagLog += '* ';
            }
            this.diagLog += newMessage;
            this.diagLog += '\r\n';
            if (this.diagLog.length > 60000)
            {
                this.diagLog = this.diagLog.substr(this.diagLog.length - 60000);
            }
            this.homey.api.realtime('com.switchbot.logupdated', { log: this.diagLog });
        }
    }

    async sendLog(logType, replyAddress, deviceId, oAuth2Client)
    {
        let tries = 5;
        this.log('Send Log');
        while (tries-- > 0)
        {
            try
            {
                let subject = '';
                let text = '';
                if (logType === 'infoLog')
                {
                    subject = 'SwitchBot Information log';
                    text = this.diagLog;
                }
                else if (logType === 'statusLog')
                {
                    subject = 'SwitchBot Status log';
                    text = this.deviceStatusLog;
                }
                else if (logType === 'deviceLog')
                {
                    subject = 'SwitchBot device log';
                    text = this.detectedDevices;
                }
                else
                {
                    subject = 'SwitchBot Homey log';

                    text = 'SwitchBot Information log\n\n';
                    text += this.diagLog;

                    text += '\n\n============================================\nSwitchBot detected devices log\n\n';
                    text += this.detectedDevices;

                    text += `\n\n============================================\nSwitchBot device Status ${deviceId}\n\n`;
                    let retval = null;
                    if (oAuth2Client)
                    {
                        const data = await this.oAuth2Client.getDeviceData(deviceId);
                        retval = data.body;
                    }
                    else
                    {
                        retval = await this.getDeviceStatus(deviceId);
                    }

                    if (retval)
                    {
                        text += JSON.stringify(retval, null, 2);
                    }
                }

                subject += `(${this.homeyHash} : ${Homey.manifest.version})`;

                // create reusable transporter object using the default SMTP transport
                const transporter = nodemailer.createTransport(
                    {
                        host: Homey.env.MAIL_HOST, // Homey.env.MAIL_HOST,
                        port: 465,
                        ignoreTLS: false,
                        secure: true, // true for 465, false for other ports
                        auth:
                        {
                            user: Homey.env.MAIL_USER, // generated ethereal user
                            pass: Homey.env.MAIL_SECRET, // generated ethereal password
                        },
                        tls:
                        {
                            // do not fail on invalid certs
                            rejectUnauthorized: false,
                        },
                    },
                );

                // send mail with defined transport object
                const response = await transporter.sendMail(
                    {
                        from: `"Homey User" <${Homey.env.MAIL_USER}>`, // sender address
                        to: Homey.env.MAIL_RECIPIENT, // list of receivers
                        cc: replyAddress,
                        subject, // Subject line
                        text, // plain text body
                    },
                );

                return {
                    error: response,
                    message: 'OK',
                };
            }
            catch (err)
            {
                this.logInformation('Send log error', err);
                return {
                    error: err,
                    message: null,
                };
            }
        }

        return {
            error: 'Failed',
            message: 'Max tries',
        };
    }

    async Delay(period)
    {
        await new Promise(resolve => this.homey.setTimeout(resolve, period));
    }

    //= ======================================================================================
    // BLEHub interface

    /// //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // SwitchBot Hub
    //
    async getDeviceStatus(deviceId)
    {
        return this.hub.getDeviceData(deviceId);
    }

    registerHUBPolling()
    {
        this.hubDevices++;
        if (this.timerHubID === null)
        {
            this.timerHubID = this.homey.setTimeout(this.onHubPoll, MINIMUM_POLL_INTERVAL);
        }
    }

    unregisterHUBPolling()
    {
        this.hubDevices--;
        if ((this.hubDevices === 0) && (this.timerHubID !== null))
        {
            this.homey.clearTimeout(this.timerHubID);
            this.timerHubID = null;
        }
    }

    async onHubPoll()
    {
        this.homey.app.updateLog('Polling hub');

        if (this.timerHubID)
        {
            this.homey.clearTimeout(this.timerHubID);
            this.timerHubID = null;
        }

        let totalHuBDevices = 0;
        const promises = [];

        const drivers = this.homey.drivers.getDrivers();
        for (const driver of Object.values(drivers))
        {
            const devices = driver.getDevices();
            for (const device of Object.values(devices))
            {
                if (device.getHubDeviceValues)
                {
                    totalHuBDevices++;
                    promises.push(device.getHubDeviceValues());
                }
            }
        }

        await Promise.all(promises);

        if (totalHuBDevices > 0)
        {
            let nextInterval = (MINIMUM_POLL_INTERVAL * 1000 * totalHuBDevices);
            if (nextInterval < (8700 * totalHuBDevices))
            {
                nextInterval = (8700 * totalHuBDevices);
            }

            this.homey.app.updateLog(`Next HUB polling interval = ${nextInterval / 1000}s`, true);
            this.timerHubID = this.homey.setTimeout(this.onHubPoll, nextInterval);
        }
    }

    registerBLEPolling()
    {
        this.bleDevices++;
        if (this.bleTimerID === null)
        {
            this.bleTimerID = this.homey.setTimeout(this.onBLEPoll, BLE_POLLING_INTERVAL);
        }
    }

    unregisterBLEPolling()
    {
        this.bleDevices--;
        if ((this.bleDevices === 0) && (this.bleTimerID !== null))
        {
            this.homey.clearTimeout(this.bleTimerID);
            this.bleTimerID = null;
        }
    }

    /// ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Homey BLE
    //
    async onBLEPoll()
    {
        this.homey.app.updateLog('\r\nPolling BLE Starting ------------------------------------');

        const promises = [];
        try
        {
            // Run discovery too fetch new data
            await this.homey.ble.discover(['cba20d00224d11e69fb80002a5d5c51b'], 2000);
            this.homey.app.updateLog('BLE Finished Discovery');

            // eslint-disable-next-line no-restricted-syntax
            const drivers = this.homey.drivers.getDrivers();
            for (const driver of Object.values(drivers))
            {
                const devices = driver.getDevices();
                for (const device of Object.values(devices))
                {
                    if (device.getDeviceValues)
                    {
                        promises.push(device.getDeviceValues());
                    }
                }
            }

            this.homey.app.updateLog('Polling BLE: waiting for devices to update');
            await Promise.all(promises);
        }
        catch (err)
        {
            this.homey.app.updateLog(`BLE Polling Error: ${this.homey.app.varToString(err)}`);
        }

        // this.polling = false;
        this.homey.app.updateLog('------------------------------------ Polling BLE Finished\r\n');

        this.homey.app.updateLog(`Next BLE polling interval = ${BLE_POLLING_INTERVAL}`, true);

        this.bleTimerID = this.homey.setTimeout(this.onBLEPoll, BLE_POLLING_INTERVAL);
    }

}

module.exports = MyApp;
