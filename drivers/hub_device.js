/* jslint node: true */

'use strict';

const { OAuth2Device } = require('homey-oauth2app');

class HubDevice extends OAuth2Device
{

    async onOAuth2Init()
    {
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

    updateLogEnabledSetting(level)
    {
       this.setSettings({ logLevel: level.toString() });
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

   async onCapabilitySendLog(value)
   {
    const dd = this.getData();
    this.homey.app.sendLog('diag', this.getSetting('replyEmail'), dd.id);
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
