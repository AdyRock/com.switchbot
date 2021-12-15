/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

const NUM_BUTTONS = 12;

class CustomRemoteHubDevice extends HubDevice
{

    /**
     * onInit is called when the device is initialized.
     */
    async onInit()
    {
        await super.onInit();

        for (let i = 0; i < NUM_BUTTONS; i++)
        {
            this.registerCapabilityListener(`button.b${i}`, this.onCapabilityButtonPressed.bind(this, i));
        }

        this.log('CustomRemoteHubDevice has been initialized');
    }

    async onSettings({ oldSettings, newSettings, changedKeys })
    {
        if (changedKeys.length > 0)
        {
            setImmediate(() =>
            {
                const buttons = this.getButtons();
                this.setButtons(buttons, false);
            });
        }

        if (changedKeys.indexOf('logLevel') >= 0)
        {
            setImmediate(() =>
            {
                this.homey.app.updateLogEnabledSetting(newSettings.logLevel);
            });
        }
     }

    async onCapabilityButtonPressed(buttonIdx)
    {
        const settings = this.getSettings();
        this._operateRemote(settings[`button${buttonIdx}`]).catch(err =>
            {
                this.log(err.message);
            });
    }

    getButtons()
    {
        const settings = this.getSettings();
        const buttons = [];
        for (let i = 0; i < NUM_BUTTONS; i++)
        {
            buttons.push(settings[`button${i}`]);
        }

        return buttons;
    }

    getButtonList()
    {
        const settings = this.getSettings();
        const buttons = [];
        for (let i = 0; i < NUM_BUTTONS; i++)
        {
            if (settings[`button${i}`])
            {
                const entry = { name: settings[`button${i}`], id: i };
                buttons.push(entry);
            }
        }

        return buttons;
    }

    async setButtons(buttons, updateSettings)
    {
        if (updateSettings)
        {
            this.setSettings(
                {
                    button1: buttons[0],
                    button2: buttons[1],
                    button3: buttons[2],
                    button4: buttons[3],
                    button5: buttons[4],
                    button6: buttons[5],
                    button7: buttons[6],
                    button8: buttons[7],
                    button9: buttons[8],
                    button10: buttons[9],
                    button11: buttons[10],
                    button12: buttons[11],
                },
            );
        }

        for (let i = 0; i < NUM_BUTTONS; i++)
        {
            await this.setButton(`button.b${i}`, buttons[i]);
        }
    }

    async setButton(capabilityId, buttonText)
    {
        if (buttonText)
        {
            if (this.hasCapability(capabilityId))
            {
                await this.setCapabilityOptions(capabilityId, { title: buttonText });
            }
            else
            {
                await this.addCapability(capabilityId);
                await this.setCapabilityOptions(capabilityId, { title: buttonText }).catch(this.error);
            }
        }
        else if (this.hasCapability(capabilityId))
        {
            await this.removeCapability(capabilityId).catch(this.error);
        }

        return true;
    }

}

module.exports = CustomRemoteHubDevice;
