/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

const NUM_BUTTONS = 36;

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
	}

	async onCapabilityButtonPressed(buttonIdx)
	{
		const settings = this.getSettings();
		this._operateRemote(settings[`button${buttonIdx}`]).catch((err) =>
		{
			this.homey.app.updateLog(`Remote onCapabilityButtonPressed: ${this.homey.app.varToString(err.message)}`, 0);
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
				button13: buttons[12],
				button14: buttons[13],
				button15: buttons[14],
				button16: buttons[15],
				button17: buttons[16],
				button18: buttons[17],
				button19: buttons[18],
				button20: buttons[19],
				button21: buttons[20],
				button22: buttons[21],
				button23: buttons[22],
				button24: buttons[23],
				button25: buttons[24],
				button26: buttons[25],
				button27: buttons[26],
				button28: buttons[27],
				button29: buttons[28],
				button30: buttons[29],
				button31: buttons[30],
				button32: buttons[31],
				button33: buttons[32],
				button34: buttons[33],
				button35: buttons[34],
				button36: buttons[35],
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
