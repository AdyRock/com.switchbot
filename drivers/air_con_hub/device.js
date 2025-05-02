/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class AirConHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();

		const dd = this.getData();
		this.diy = dd.diy;

		if (this.hasCapability('onoff'))
		{
			this.removeCapability('onoff').catch(this.error);
			this.addCapability('power_on').catch(this.error);
			this.addCapability('power_off').catch(this.error);
		}

		if (this.diy)
		{
			if (this.hasCapability('target_temperature'))
			{
				this.removeCapability('target_temperature').catch(this.error);;
			}
			if (this.hasCapability('aircon_mode'))
			{
				this.removeCapability('aircon_mode').catch(this.error);;
			}
			if (this.hasCapability('aircon_fan_speed'))
			{
				this.removeCapability('aircon_fan_speed').catch(this.error);;
			}
		}
		else
		{
			this.registerMultipleCapabilityListener(['onoff', 'target_temperature', 'aircon_mode', 'aircon_fan_speed'], this.onCapabilityAll.bind(this));
		}

		this.registerCapabilityListener('power_off', this.onCapabilityPowerOff.bind(this));
		this.registerCapabilityListener('power_on', this.onCapabilityPowerOn.bind(this));

		let temp = this.getCapabilityValue('target_temperature');
		if (temp === null)
		{
			this.setCapabilityValue('target_temperature', 21).catch(this.error);
		}

		temp = this.getCapabilityValue('aircon_mode');
		if (temp === null)
		{
			this.setCapabilityValue('aircon_mode', '2').catch(this.error);
		}

		temp = this.getCapabilityValue('aircon_fan_speed');
		if (temp === null)
		{
			this.setCapabilityValue('aircon_fan_speed', '2').catch(this.error);
		}

		this.log('AirConHubDevice has been initialized');
	}

	async onCapabilityPowerOff(value, opts)
	{
		if (this.diy)
		{
			const data = {
				command: 'turnOff',
				parameter: 'default',
				commandType: 'command',
			};

			return super.setDeviceData(data);
		}

		return this.onCapabilityAll({ power_off: true });
	}

	async onCapabilityPowerOn(value, opts)
	{
		if (this.diy)
		{
			const data = {
				command: 'turnOn',
				parameter: 'default',
				commandType: 'command',
			};

			return super.setDeviceData(data);
		}

		return this.onCapabilityAll({ power_on: true });
	}

	async onCapabilityCommand(command)
	{
		if (command === 'turnOn')
		{
			return this.onCapabilityPowerOn();
		}

		return this.onCapabilityPowerOff();
	}

	// this method is called when the Homey device has requested a value change
	async onCapabilityAll(valueOj, optsObj)
	{
		let temp;
		let mode;
		let fan;
		let onOff = 'on';

		if (valueOj.onoff !== undefined && valueOj.onOff === false)
		{
			onOff = 'off';
		}

		if (valueOj.power_off)
		{
			onOff = 'off';
		}

		if (valueOj.target_temperature)
		{
			temp = valueOj.target_temperature;
		}
		else
		{
			temp = this.getCapabilityValue('target_temperature');
			if (temp === null)
			{
				temp = 22;
			}
		}

		if (valueOj.aircon_mode)
		{
			mode = valueOj.aircon_mode;
		}
		else
		{
			mode = this.getCapabilityValue('aircon_mode');
			if (mode === null)
			{
				mode = '2';
			}
		}

		if (valueOj.aircon_fan_speed)
		{
			fan = valueOj.aircon_fan_speed;
		}
		else
		{
			fan = this.getCapabilityValue('aircon_fan_speed');
			if (fan === null)
			{
				fan = '2';
			}
		}

		mode = Number(mode);
		fan = Number(fan);

		const parameters = `${temp},${mode},${fan},${onOff}`;
		return this._operateDevice(parameters);
	}

	async _operateDevice(parameters)
	{
		const data = {
			command: 'setAll',
			parameter: parameters,
			commandType: 'command',
		};

		return super.setDeviceData(data);
	}

}

module.exports = AirConHubDevice;
