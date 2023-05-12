/* jslint node: true */

'use strict';

const HubDevice = require('./hub_device');

class LightHubDevice extends HubDevice
{

    /**
     * onOAuth2Init is called when the device is initialized.
     */
    async onInit()
    {
        await super.onInit();

        this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
        this.registerCapabilityListener('dim', this.onCapabilityDim.bind(this));
        if (this.hasCapability('light_mode'))
        {
            this.registerCapabilityListener('light_mode', this.onCapabilityLightMode.bind(this));
        }
        if (this.hasCapability('light_temperature'))
        {
            this.registerCapabilityListener('light_temperature', this.onCapabilityLightTemperature.bind(this));
        }
        
        this.registerMultipleCapabilityListener(['light_hue', 'light_saturation'], this.onCapabilityLightHueSat.bind(this), 500);

        try
        {
            await this.getHubDeviceValues();
        }
        catch (err)
        {
            this.setUnavailable(err.message);
        }

        const dd = this.getData();
        this.homey.app.registerHomeyWebhook(dd.id);
    }

    // this method is called when the Homey device switches the device on or off
    async onCapabilityOnOff(value, opts)
    {
        const command = value ? 'turnOn' : 'turnOff';
        return this.sendCommand(command, 'default');
    }

    async onCapabilityLightMode(value, opts)
    {
        // No need to do anything
    }

    async onCapabilityDim(value, opts)
    {
        const command = 'setBrightness';
        return this.sendCommand(command, value * 100);
    }

    async onCapabilityLightTemperature(value, opts)
    {
        // {2700-6500}
        const command = 'setColorTemperature';
        return this.sendCommand(command, ((1 - value) * (6500 - 2700)) + 2700);
    }

    async onCapabilityLightHueSat(capabilityValues, capabilityOptions)
    {
        // Convert Hue, Saturation, Dim to RGB
        const dim = 0.5;
        const rgb = this.hslToRgb(capabilityValues.light_hue, capabilityValues.light_saturation, dim);

        const command = 'setColor';
        return this.sendCommand(command, `${rgb[0]}:${rgb[1]}:${rgb[2]}`);
    }

    hslToRgb(h, s, l)
    {
        h *= 360;
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = l - c / 2;
        let r = 0;
        let g = 0;
        let b = 0;

        if (h >= 0 && h < 60)
        {
            r = c;
            g = x;
            b = 0;
        }
        else if (h >= 60 && h < 120)
        {
            r = x;
            g = c;
            b = 0;
        }
        else if (h >= 120 && h < 180)
        {
            r = 0;
            g = c;
            b = x;
        }
        else if (h >= 180 && h < 240)
        {
            r = 0;
            g = x;
            b = c;
        }
        else if (h >= 240 && h < 300)
        {
            r = x;
            g = 0;
            b = c;
        }
        else if (h >= 300 && h < 360)
        {
            r = c;
            g = 0;
            b = x;
        }
        r = Math.round((r + m) * 255);
        g = Math.round((g + m) * 255);
        b = Math.round((b + m) * 255);

        return [r, g, b];
    }

    rgbToHsl(r, g, b)
    {
        // Make r, g, and b fractions of 1
        r /= 255;
        g /= 255;
        b /= 255;

        // Find greatest and smallest channel values
        const cMin = Math.min(r, g, b);
        const cMax = Math.max(r, g, b);
        const delta = cMax - cMin;
        let h = 0;
        let s = 0;
        let l = 0;
        // Calculate hue
        // No difference
        if (delta === 0)
        {
            h = 0;
        }
        // Red is max
        else if (cMax === r)
        {
            h = ((g - b) / delta) % 6;
        }
        // Green is max
        else if (cMax === g)
        {
            h = (b - r) / delta + 2;
        }
        // Blue is max
        else
        {
            h = (r - g) / delta + 4;
        }

        h = Math.round(h * 60);

        // Make negative hues positive behind 360°
        if (h < 0)
        {
            h += 360;
        }

        // Calculate lightness
        l = (cMax + cMin) / 2;

        // Calculate saturation
        s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

        // Multiply l and s by 100
        s = +(s * 100).toFixed(1);
        l = +(l * 100).toFixed(1);

        return [h, s, l];
    }

    async sendCommand(command, parameter)
    {
        const data = {
            command,
            parameter,
            commandType: 'command',
        };

        return super.setDeviceData(data);
    }

    async getHubDeviceValues()
    {
        try
        {
            const data = await this._getHubDeviceValues();
            if (data)
            {
                this.setAvailable();
                this.homey.app.updateLog(`Strip Light Hub got: ${this.homey.app.varToString(data)}`, 3);

                this.setCapabilityValue('onoff', data.power === 'on').catch(this.error);
                this.setCapabilityValue('dim', data.brightness / 100).catch(this.error);

                if (data.colorTemperature && (data.colorTemperature > 2700))
                {
                    this.setCapabilityValue('light_mode', 'temperature').catch(this.error);
                    this.setCapabilityValue('light_temperature', 1 - (data.colorTemperature - 2700) / (6500 - 2700));
                }
                else
                {
                    if (this.hasCapability('light_mode'))
                    {
                        this.setCapabilityValue('light_mode', 'color').catch(this.error);
                    }

                    const rgb = data.color.split(':');
                    const hsl = this.rgbToHsl(rgb[0], rgb[1], rgb[2]);

                    this.setCapabilityValue('light_hue', hsl[0] / 360).catch(this.error);
                    this.setCapabilityValue('light_saturation', hsl[1] / 100).catch(this.error);
                }
                this.unsetWarning();
            }
        }
        catch (err)
        {
            this.homey.app.updateLog(`Light getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
            this.setWarning(err.message);
        }
    }

    async processWebhookMessage(message)
    {
        try
        {
            const dd = this.getData();
            if (dd.id === message.context.deviceMac)
            {
                // message is for this device
                this.setCapabilityValue('onoff', message.context.powerState === 'ON').catch(this.error);
                this.setCapabilityValue('dim', message.context.brightness / 100).catch(this.error);
                if (message.context.colorTemperature && (message.context.colorTemperature >= 2700))
                {
                    this.setCapabilityValue('light_mode', 'temperature').catch(this.error);
                    this.setCapabilityValue('light_temperature', 1 - (message.context.colorTemperature - 2700) / (6500 - 2700)).catch(this.error);
                }
                else
                {
                    if (this.hasCapability('light_mode'))
                    {
                        this.setCapabilityValue('light_mode', 'color').catch(this.error);
                    }
                    const rgb = message.context.color.split(':');
                    const hsl = this.rgbToHsl(rgb[0], rgb[1], rgb[2]);

                    this.setCapabilityValue('light_hue', hsl[0] / 360).catch(this.error);
                    this.setCapabilityValue('light_saturation', hsl[1] / 100).catch(this.error);
                }
            }
        }
        catch (err)
        {
            this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
        }
    }

}

module.exports = LightHubDevice;
