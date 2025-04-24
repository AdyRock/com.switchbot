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

		if (this.hasCapability('button.send_log'))
		{
			this.removeCapability('button.send_log');
		}

		if (!this.pollHubDeviceValues)
		{
			// Set a random timer to fetch initial values from the hub device
			const randomDelay = Math.floor(Math.random() * 10000) + 5000; // between 5 and 15 seconds
			this.homey.app.updateLog(`fetch initial values in ${randomDelay} ms`, 3);
			setTimeout(() =>
			{
				this.getHubDeviceValues();
			}
			, randomDelay);
		}
		else
		{
			// Polling is enabled, so we need to fetch the initial values from the hub device
			this.homey.app.registerHUBPolling();
		}
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
		// Called when settings changed
	}

	async setDeviceData(data)
	{
		let result = null;
		const dd = this.getData();
		if (this.oAuth2Client)
		{
			try
			{
				this.homey.app.apiCalls++;
				this.homey.settings.set('apiCalls', this.homey.app.apiCalls);

				this.homey.app.updateLog(`Sending ${this.homey.app.varToString(data)} to ${dd.id} using OAuth`, 3);
				result = await this.oAuth2Client.setDeviceData(dd.id, data);
			}
			catch (err)
			{
				this.homey.app.updateLog(`Failed to send command to ${dd.id} using OAuth: ${err.message}`, 0);
				throw (err.message);
			}

			if (!result)
			{
				this.homey.app.updateLog(`Failed to send command to ${dd.id} using OAuth: Nothing returned`, 0);
				throw new Error('Nothing returned');
			}

			if (result.statusCode !== 100)
			{
				this.homey.app.updateLog(`Failed to send command to ${dd.id} using OAuth: ${result.statusCode}`, 0);
				if (result.statusCode === 152)
				{
					throw new Error('Error: Device not found by SwitchBot');
				}
				else if (result.statusCode === 160)
				{
					throw new Error('Error: Command is not supported by SwitchBot');
				}
				else if (result.statusCode === 161)
				{
					throw new Error('Error: SwitchBot device is offline');
				}
				else if (result.statusCode === 171)
				{
					throw new Error('Error: SwitchBot hub is offline');
				}
				else if (result.statusCode === 174)
				{
					throw new Error('Cloud option is not enabled in the SwitchBot app');
				}
				else if (result.statusCode === 190)
				{
					throw new Error(`Error: ${result.statusCode} ${result.message}`);
				}
				else
				{
					throw new Error(`Error: An unknown code (${result.statusCode}) returned by SwitchBot`);
				}
			}

			this.homey.app.updateLog(`Success sending command to ${dd.id} using OAuth`);
			return true;
		}

		this.homey.app.updateLog(`Sending ${this.homey.app.varToString(data)} to ${dd.id} using API key`, 3);
		result = await this.homey.app.hub.setDeviceData(dd.id, data);
		this.homey.app.updateLog(`Success sending command to ${dd.id} using API key`);
		return result;
	}

	// Override this method to get the device values
	async getHubDeviceValues()
	{
	}

	async _getHubDeviceValues()
	{
		const dd = this.getData();
		if (this.oAuth2Client)
		{
			this.homey.app.apiCalls++;
			this.homey.settings.set('apiCalls', this.homey.app.apiCalls);

			const data = await this.oAuth2Client.getDeviceData(dd.id);
			if (data.statusCode !== 100)
			{
				throw new Error(`${data.statusCode}: ${data.message} (${this.homey.app.apiCalls}) API calls`);
			}

			return data.body;
		}

		return this.homey.app.hub.getDeviceData(dd.id);
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
			this.homey.app.apiCalls++;
			this.homey.settings.set('apiCalls', this.homey.app.apiCalls);

			const retData = await this.oAuth2Client.startScene(dd.id);
			return retData.body;
		}

		return this.homey.app.hub.startScene(dd.id);
	}

}

module.exports = HubDevice;
