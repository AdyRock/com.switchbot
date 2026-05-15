/* jslint node: true */

'use strict';

const { OAuth2Device } = require('homey-oauth2app');

class HubDevice extends OAuth2Device
{

	appendApiCallCountToRateLimitError(err)
	{
		const message = (err && err.message) ? err.message : String(err);
		const isRateLimitError = /rate\s*limit|too\s*many\s*requests|\b190\b/i.test(message);
		if (!isRateLimitError)
		{
			return err;
		}

		if (/API calls/i.test(message))
		{
			return err;
		}

		return new Error(`${message} (${this.homey.app.apiCalls}) API calls`);
	}

	async onInit()
	{
		try
		{
			await super.onInit();
		}
		catch (err)
		{
			this.homey.app.updateLog(this.homey.app.varToString(err), 'hub');
		}

		if (this.hasCapability('button.send_log'))
		{
			this.removeCapability('button.send_log').catch(this.error);
		}

		if (!this.pollHubDeviceValues)
		{
			// Set a random timer to fetch initial values from the hub device
			const randomDelay = Math.floor(Math.random() * 10000) + 5000; // between 5 and 15 seconds
			this.homey.app.updateLog(`fetch initial values in ${randomDelay} ms`, 3, 'hub');
			this.homey.setTimeout(() =>
			{
				this.getHubDeviceValues().catch(this.error);
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

		if (this.homey.app.openToken)
		{
			this.homey.app.updateLog(`Sending ${this.homey.app.varToString(data)} to ${dd.id} using API key`, 3, 'hub');
			try
			{
				result = await this.homey.app.hub.setDeviceData(dd.id, data);
			}
			catch (err)
			{
				this.homey.app.updateLog(this.homey.app.varToString(err), 'hub');
			}
			this.homey.app.updateLog(`Success sending command to ${dd.id} using API key`, 'hub');
			return result;
		}

		if (this.oAuth2Client)
		{
			try
			{
				this.homey.app.updateLog(`Sending ${this.homey.app.varToString(data)} to ${dd.id} using OAuth`, 3, 'hub');
				result = await this.oAuth2Client.setDeviceData(dd.id, data);
			}
			catch (err)
			{
				this.homey.app.updateLog(`Failed to send command to ${dd.id} using OAuth: ${err.message}`, 0, 'hub');
				throw new Error(err.message);
			}

			if (!result)
			{
				this.homey.app.updateLog(`Failed to send command to ${dd.id} using OAuth: Nothing returned`, 0, 'hub');
				throw new Error('Nothing returned');
			}

			if (result.statusCode !== 100)
			{
				this.homey.app.updateLog(`Failed to send command to ${dd.id} using OAuth: ${result.statusCode}`, 0, 'hub');
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
					throw new Error(`Error: ${result.statusCode} ${result.message}, ${this.homey.app.varToString(data)}`);
				}
				else
				{
					throw new Error(`Error: An unknown code (${result.statusCode}) returned by SwitchBot`);
				}
			}

			this.homey.app.updateLog(`Success sending command to ${dd.id} using OAuth`, 'hub');
			return true;
		}

		// No API key or OAuth client available, so we cannot send the command
		this.homey.app.updateLog(`Failed to send command to ${dd.id}: No API key or OAuth client available`, 0, 'hub');
		return false;
	}

	// Override this method to get the device values
	async getHubDeviceValues()
	{
	}

	async _getHubDeviceValues()
	{
		const dd = this.getData();
		if (this.homey.app.openToken)
		{
			let data;
			try
			{
				data = await this.homey.app.hub.getDeviceData(dd.id);
			}
			catch (err)
			{
				throw this.appendApiCallCountToRateLimitError(err);
			}

			if (data.statusCode !== 100)
			{
				throw new Error(`${data.statusCode}: ${data.message} (${this.homey.app.apiCalls}) API calls`);
			}

			return data.body;
		}

		if (this.oAuth2Client)
		{
			let data;
			try
			{
				data = await this.oAuth2Client.getDeviceData(dd.id);
			}
			catch (err)
			{
				throw this.appendApiCallCountToRateLimitError(err);
			}

			if (data.statusCode !== 100)
			{
				throw new Error(`${data.statusCode}: ${data.message} (${this.homey.app.apiCalls}) API calls`);
			}

			return data.body;
		}

		throw new Error('No API key or OAuth client available');
	}

	async onCapabilitySendLog(value)
	{
		const dd = this.getData();
		try
		{
			await this.homey.app.sendLog('diag', this.getSetting('replyEmail'), dd.id, this.oAuth2Client);
		}
		catch (err)
		{
			this.homey.app.updateLog(`Failed to send diagnostics log: ${err.message}`, 0, 'hub');
		}
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
		if (this.homey.app.openToken)
		{
			const data = await this.homey.app.hub.startScene(dd.id);
			if (data.statusCode !== 100)
			{
				throw new Error(`${data.statusCode}: ${data.message} (${this.homey.app.apiCalls}) API calls`);
			}

			return data.body;
		}

		if (this.oAuth2Client)
		{
			const retData = await this.oAuth2Client.startScene(dd.id);
			return retData.body;
		}
	}

}

module.exports = HubDevice;
