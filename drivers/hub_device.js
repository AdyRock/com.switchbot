/* jslint node: true */

'use strict';

const { OAuth2Device } = require('homey-oauth2app');

const MISSING_AUTH_LOG_THROTTLE_MS = 5 * 60 * 1000;
const DEVICE_OFFLINE_COOLDOWN_MS = 30 * 1000;

class HubDevice extends OAuth2Device
{

	getOAuth2ClientForDevice()
	{
		if (this.oAuth2Client)
		{
			return this.oAuth2Client;
		}

		if (this.homey && this.homey.app && this.homey.app.getFirstSavedOAuth2Client)
		{
			return this.homey.app.getFirstSavedOAuth2Client();
		}

		return null;
	}

	logMissingAuthOnce(deviceId)
	{
		const now = Date.now();
		if (!this._missingAuthLogAt)
		{
			this._missingAuthLogAt = 0;
		}

		if ((now - this._missingAuthLogAt) >= MISSING_AUTH_LOG_THROTTLE_MS)
		{
			this.homey.app.updateLog(`Failed to send command to ${deviceId}: No API key or OAuth client available`, 0, 'hub');
			this._missingAuthLogAt = now;
		}
	}

	getOfflineCooldownUntil(deviceId)
	{
		if (!this._offlineCooldownByDevice)
		{
			this._offlineCooldownByDevice = {};
		}

		return this._offlineCooldownByDevice[deviceId] || 0;
	}

	setOfflineCooldown(deviceId, cooldownMs = DEVICE_OFFLINE_COOLDOWN_MS)
	{
		if (!this._offlineCooldownByDevice)
		{
			this._offlineCooldownByDevice = {};
		}

		this._offlineCooldownByDevice[deviceId] = Date.now() + cooldownMs;
	}

	clearOfflineCooldown(deviceId)
	{
		if (!this._offlineCooldownByDevice)
		{
			return;
		}

		delete this._offlineCooldownByDevice[deviceId];
	}

	async setDeviceOfflineWarning(deviceId)
	{
		try
		{
			await this.setWarning(`SwitchBot device ${deviceId} is offline`);
		}
		catch (err)
		{
			this.homey.app.updateLog(`Unable to set offline warning for ${deviceId}: ${err.message}`, 1, 'hub');
		}
	}

	async clearDeviceOfflineWarning(deviceId)
	{
		try
		{
			await this.unsetWarning();
		}
		catch (err)
		{
			this.homey.app.updateLog(`Unable to clear offline warning for ${deviceId}: ${err.message}`, 1, 'hub');
		}
	}

	isTransientCapabilityOptionsError(err)
	{
		const message = (err && err.message) ? err.message : String(err);
		return /setCapabilityOptionsTimeout|ECONNRESET|ETIMEDOUT|timeout|Not Found \(Redis\): Driver with ID/i.test(message);
	}

	async safeSetCapabilityOptions(capabilityId, options)
	{
		try
		{
			await this.setCapabilityOptions(capabilityId, options);
			return true;
		}
		catch (err)
		{
			if (this.isTransientCapabilityOptionsError(err))
			{
				this.homey.app.updateLog(`Transient setCapabilityOptions error for ${capabilityId}: ${err.message}`, 0, 'hub');
				return false;
			}

			this.homey.app.updateLog(`setCapabilityOptions error for ${capabilityId}: ${this.homey.app.varToString(err)}`, 0, 'hub');
			return false;
		}
	}

	appendApiCallCountToRateLimitError(err)
	{
		const message = (err && err.message) ? err.message : String(err);
		const isRateLimitError = /rate\s*limit|too\s*many\s*requests|\b429\b/i.test(message);
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
		const oAuth2Client = this.getOAuth2ClientForDevice();

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

		if (oAuth2Client)
		{
			const offlineCooldownUntil = this.getOfflineCooldownUntil(dd.id);
			if (offlineCooldownUntil > Date.now())
			{
				const remainingMs = offlineCooldownUntil - Date.now();
				this.homey.app.updateLog(`Skipping command to ${dd.id}: recent offline response, retrying after ${Math.ceil(remainingMs / 1000)}s`, 1, 'hub');
				await this.setDeviceOfflineWarning(dd.id);
				throw new Error('Error: SwitchBot device is offline');
			}

			const maxAttempts = 3;
			let responseCode = 100;
			let responseMessage = '';

			for (let attempt = 1; attempt <= maxAttempts; attempt++)
			{
				try
				{
					this.homey.app.updateLog(`Sending ${this.homey.app.varToString(data)} to ${dd.id} using OAuth${attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : ''}`, 3, 'hub');
					result = await oAuth2Client.setDeviceData(dd.id, data);
				}
				catch (err)
				{
					this.homey.app.updateLog(`Failed to send command to ${dd.id} using OAuth: ${err.message}`, 0, 'hub');
					throw new Error(err.message);
				}

				if (!result)
				{
					if (attempt < maxAttempts)
					{
						const baseDelay = 700 * Math.pow(2, attempt - 1);
						const retryDelay = baseDelay + Math.floor(Math.random() * 250);
						this.homey.app.updateLog(`OAuth command to ${dd.id} returned no body, retrying in ${retryDelay}ms (attempt ${attempt}/${maxAttempts})`, 1, 'hub');
						await new Promise((resolve) => this.homey.setTimeout(resolve, retryDelay));
						continue;
					}

					this.homey.app.updateLog(`Failed to send command to ${dd.id} using OAuth: Nothing returned`, 0, 'hub');
					throw new Error('Nothing returned');
				}

				responseCode = Number.parseInt(result.statusCode ?? result.body?.statusCode ?? 100, 10);
				responseMessage = result.message ?? result.body?.message ?? '';

				if ((responseCode === 171) && (attempt < maxAttempts))
				{
					const baseDelay = 700 * Math.pow(2, attempt - 1);
					const retryDelay = baseDelay + Math.floor(Math.random() * 250);
					this.homey.app.updateLog(`Transient SwitchBot response ${responseCode} for ${dd.id}, retrying in ${retryDelay}ms (attempt ${attempt}/${maxAttempts})`, 1, 'hub');
					await new Promise((resolve) => this.homey.setTimeout(resolve, retryDelay));
					continue;
				}

				break;
			}

			if (responseCode !== 100)
			{
				this.homey.app.updateLog(`Failed to send command to ${dd.id} using OAuth: ${responseCode} ${responseMessage}`.trim(), 0, 'hub');
				if (responseCode === 152)
				{
					throw new Error('Error: Device not found by SwitchBot');
				}
				else if (responseCode === 160)
				{
					throw new Error('Error: Command is not supported by SwitchBot');
				}
				else if (responseCode === 161)
				{
					this.setOfflineCooldown(dd.id);
					await this.setDeviceOfflineWarning(dd.id);
					throw new Error('Error: SwitchBot device is offline');
				}
				else if (responseCode === 171)
				{
					throw new Error('Error: SwitchBot hub is offline');
				}
				else if (responseCode === 174)
				{
					throw new Error('Cloud option is not enabled in the SwitchBot app');
				}
				else if (responseCode === 190)
				{
					throw new Error(`Error: ${responseCode} ${responseMessage || 'Command rejected by SwitchBot'}, ${this.homey.app.varToString(data)}`);
				}
				else
				{
					throw new Error(`Error: An unknown code (${responseCode}) returned by SwitchBot`);
				}
			}

			this.clearOfflineCooldown(dd.id);
			await this.clearDeviceOfflineWarning(dd.id);
			this.homey.app.updateLog(`Success sending command to ${dd.id} using OAuth`, 'hub');
			return true;
		}

		// No API key or OAuth client available, so we cannot send the command
		this.logMissingAuthOnce(dd.id);
		return false;
	}

	// Override this method to get the device values
	async getHubDeviceValues()
	{
	}

	async _getHubDeviceValues()
	{
		const dd = this.getData();
		const oAuth2Client = this.getOAuth2ClientForDevice();
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

			this.clearOfflineCooldown(dd.id);
			await this.clearDeviceOfflineWarning(dd.id);
			return data.body;
		}

		if (oAuth2Client)
		{
			let data;
			try
			{
				data = await oAuth2Client.getDeviceData(dd.id);
			}
			catch (err)
			{
				throw this.appendApiCallCountToRateLimitError(err);
			}

			if (data.statusCode !== 100)
			{
				throw new Error(`${data.statusCode}: ${data.message} (${this.homey.app.apiCalls}) API calls`);
			}

			this.clearOfflineCooldown(dd.id);
			await this.clearDeviceOfflineWarning(dd.id);
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
		const oAuth2Client = this.getOAuth2ClientForDevice();
		if (this.homey.app.openToken)
		{
			const data = await this.homey.app.hub.startScene(dd.id);
			if (data.statusCode !== 100)
			{
				throw new Error(`${data.statusCode}: ${data.message} (${this.homey.app.apiCalls}) API calls`);
			}

			return data.body;
		}

		if (oAuth2Client)
		{
			const retData = await oAuth2Client.startScene(dd.id);
			return retData.body;
		}
	}

}

module.exports = HubDevice;
