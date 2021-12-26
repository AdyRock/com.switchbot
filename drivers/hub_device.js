/* jslint node: true */

'use strict';

const { OAuth2Device } = require('homey-oauth2app');

class HubDevice extends OAuth2Device
{

    async onInit()
    {
        try
        {
            await super.onInit();
        }
        catch (err)
        {
            this.log(err);
        }

        if (!this.hasCapability('button.send_log'))
        {
            this.addCapability('button.send_log');
        }

        this.registerCapabilityListener('button.send_log', this.onCapabilitySendLog.bind(this));
        this.updateLogEnabledSetting(this.homey.settings.get('logLevel'));
        this.homey.app.registerHUBPolling();
    }

    /**
     * onDeleted is called when the user deleted the device.
     */
    async onOAuth2Deleted()
    {
        this.homey.app.unregisterHUBPolling();

        this.log('HubDevice has been deleted');
    }

    /**
     * onSettings is called when the user updates the device's settings.
     * @param {object} event the onSettings event data
     * @param {object} event.oldSettings The old settings object
     * @param {object} event.newSettings The new settings object
     * @param {string[]} event.changedKeys An array of keys changed since the previous version
     * @returns {Promise<string|void>} return a custom message that will be displayed
     */
    async onSettings({ oldSettings, newSettings, changedKeys })
    {
        if (changedKeys.indexOf('logLevel') >= 0)
        {
            setImmediate(() =>
            {
                this.homey.app.updateLogEnabledSetting(Number(newSettings.logLevel));
            });
        }
    }

    async setDeviceData(data)
    {
        const dd = this.getData();
        if (this.oAuth2Client)
        {
            return this.oAuth2Client.setDeviceData(dd.id, data);
        }
        return this.homey.app.hub.setDeviceData(dd.id, data);
    }

    async _getHubDeviceValues()
    {
        const dd = this.getData();
        if (this.oAuth2Client)
        {
            const data = await this.oAuth2Client.getDeviceData(dd.id);
            return data.body;
        }

        return this.homey.app.hub.getDeviceData(dd.id);
    }

    updateLogEnabledSetting(level)
    {
        this.setSettings({ logLevel: level.toString() });
    }

    async onCapabilitySendLog(value)
    {
        const dd = this.getData();
        this.homey.app.sendLog('diag', this.getSetting('replyEmail'), dd.id, this.oAuth2Client);
    }

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

        return this.setDeviceData(data);
    }

    async _operateRemote(command)
    {
        const data = {
            command,
            parameter: 'default',
            commandType: 'customize',
        };

        return this.setDeviceData(data);
    }

    async startScene()
    {
        const dd = this.getData();

        if (this.oAuth2Client)
        {
            const retData = await this.oAuth2Client.startScene(dd.id);
            return retData.body;
        }

        return this.homey.app.hub.startScene(dd.id);
    }

}

module.exports = HubDevice;
