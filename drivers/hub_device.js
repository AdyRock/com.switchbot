/* jslint node: true */

'use strict';

const { OAuth2Device } = require('homey-oauth2app');

const MISSING_AUTH_LOG_THROTTLE_MS = 5 * 60 * 1000;
const DEVICE_OFFLINE_COOLDOWN_MS = 30 * 1000;
const DEVICE_OFFLINE_COOLDOWN_MAX_MS = 5 * 60 * 1000;
const SWITCHBOT_DEVICE_OFFLINE = 161;
const SWITCHBOT_HUB_OFFLINE = 171;

class HubDevice extends OAuth2Device
{

	getOAuth2ClientForDevice()
	{
		if (typeof super.getOAuth2Client === 'function')
		{
			try
			{
				const deviceOAuth2Client = super.getOAuth2Client();
				if (deviceOAuth2Client)
				{
					this.oAuth2Client = deviceOAuth2Client;
					return deviceOAuth2Client;
				}
			}
			catch (err)
			{
				this.homey.app.updateLog(`Unable to resolve OAuth client for device: ${err.message}`, 1, 'hub');
			}
		}

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

	isOfflineCode(code)
	{
		const value = Number.parseInt(code, 10);
		return (value === SWITCHBOT_DEVICE_OFFLINE) || (value === SWITCHBOT_HUB_OFFLINE);
	}

	getOfflineMessage(code)
	{
		return (Number.parseInt(code, 10) === SWITCHBOT_HUB_OFFLINE)
			? 'The SwitchBot hub for this device is offline'
			: 'SwitchBot device is offline';
	}

	getActiveOfflineCooldown(deviceId)
	{
		const entry = this._offlineCooldownByDevice ? this._offlineCooldownByDevice[deviceId] : null;
		return (entry && (entry.until > Date.now())) ? entry : null;
	}

	clearOfflineCooldown(deviceId)
	{
		if (!this._offlineCooldownByDevice)
		{
			return false;
		}

		const hadEntry = Boolean(this._offlineCooldownByDevice[deviceId]);
		delete this._offlineCooldownByDevice[deviceId];
		return hadEntry;
	}

	// While a device (or its hub) is known to be offline, requests are not sent to SwitchBot so they don't use API quota
	async checkOfflineCooldown(deviceId, action)
	{
		const cooldown = this.getActiveOfflineCooldown(deviceId);
		if (!cooldown)
		{
			return;
		}

		const message = this.getOfflineMessage(cooldown.code);
		this.homey.app.updateLog(`Skipping ${action} for ${deviceId}: ${message}, next attempt allowed in ${Math.ceil((cooldown.until - Date.now()) / 1000)}s`, 1, 'hub');
		await this.setDeviceOfflineWarning(deviceId, message);
		throw new Error(message);
	}

	// An offline response ends the request without retrying. Further requests are skipped for a cool-down
	// period that doubles while the device stays offline and is reset by the next successful request.
	async handleOfflineResponse(deviceId, code, responseMessage, action)
	{
		if (!this._offlineCooldownByDevice)
		{
			this._offlineCooldownByDevice = {};
		}

		const previous = this._offlineCooldownByDevice[deviceId];
		const cooldownMs = previous ? Math.min(previous.cooldownMs * 2, DEVICE_OFFLINE_COOLDOWN_MAX_MS) : DEVICE_OFFLINE_COOLDOWN_MS;
		this._offlineCooldownByDevice[deviceId] = { until: Date.now() + cooldownMs, cooldownMs, code: Number.parseInt(code, 10) };

		const message = this.getOfflineMessage(code);
		const responseText = responseMessage ? ` ${responseMessage}` : '';
		this.homey.app.updateLog(`${action} for ${deviceId} failed: ${code}${responseText} - ${message}, not retrying for ${cooldownMs / 1000}s`, 0, 'hub');
		await this.setDeviceOfflineWarning(deviceId, message);
		return new Error(message);
	}

	async setDeviceOfflineWarning(deviceId, message = 'SwitchBot device is offline')
	{
		try
		{
			await this.setWarning(message);
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

	async setRateLimitWarning()
	{
		this.rateLimitWarningActive = true;
		try
		{
			await this.setWarning(this.homey.app.getRateLimitWarningText());
		}
		catch (err)
		{
			this.homey.app.updateLog(`Unable to set rate limit warning for ${this.getName()}: ${err.message}`, 1, 'hub');
		}
	}

	// Only clears the warning if it was set because of the rate limit, so other warnings are kept
	async clearRateLimitWarning()
	{
		if (!this.rateLimitWarningActive)
		{
			return;
		}

		this.rateLimitWarningActive = false;
		try
		{
			await this.unsetWarning();
		}
		catch (err)
		{
			this.homey.app.updateLog(`Unable to clear rate limit warning for ${this.getName()}: ${err.message}`, 1, 'hub');
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
		const { OAuth2SessionId } = this.getStore();
		const hasLegacyAuth = Boolean(this.homey.app.openToken && this.homey.app.openSecret);
		if (!OAuth2SessionId && hasLegacyAuth)
		{
			// Paired with a legacy API token/secret, so there is no OAuth2 session to
			// bind. Run the initialisation that OAuth2Device.onInit would normally call.
			this.homey.app.updateLog('Device initialised without an OAuth2 session; using legacy API token', 2, 'hub');
			try
			{
				await this.onOAuth2Init();
			}
			catch (err)
			{
				this.homey.app.updateLog(this.homey.app.varToString(err), 'hub');
			}
		}
		else
		{
			try
			{
				await super.onInit();
			}
			catch (err)
			{
				this.homey.app.updateLog(this.homey.app.varToString(err), 'hub');
			}
		}

		if (this.hasCapability('button.send_log'))
		{
			this.removeCapability('button.send_log').catch(this.error);
		}

		if (this.homey.app.isRateLimited())
		{
			// Still within a rate limit back-off from before the app restarted
			this.setRateLimitWarning().catch(this.error);
		}

		if (!this.pollHubDeviceValues)
		{
			this.scheduleInitialHubValuesFetch();
		}
		else
		{
			// Polling is enabled, so we need to fetch the initial values from the hub device
			this.homey.app.registerHUBPolling();
		}
	}

	// Fetch the initial values after a random delay, deferring until any SwitchBot rate limit back-off has expired
	scheduleInitialHubValuesFetch()
	{
		const randomDelay = Math.floor(Math.random() * 10000) + 5000; // between 5 and 15 seconds
		const delay = randomDelay + this.homey.app.getRateLimitResumeDelay();
		this.homey.app.updateLog(`fetch initial values in ${delay} ms`, 3, 'hub');
		this.homey.setTimeout(() =>
		{
			if (this.homey.app.isRateLimited())
			{
				this.scheduleInitialHubValuesFetch();
				return;
			}

			this.getHubDeviceValues().catch(this.error);
		},
		delay);
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
			await this.checkOfflineCooldown(dd.id, 'command');
			this.homey.app.updateLog(`Sending ${this.homey.app.varToString(data)} to ${dd.id} using API key`, 3, 'hub');
			try
			{
				result = await this.homey.app.hub.setDeviceData(dd.id, data);
			}
			catch (err)
			{
				if (this.isOfflineCode(err.statusCode))
				{
					throw await this.handleOfflineResponse(dd.id, err.statusCode, err.message, 'Command');
				}

				this.homey.app.updateLog(this.homey.app.varToString(err), 'hub');
			}

			if (result && this.clearOfflineCooldown(dd.id))
			{
				await this.clearDeviceOfflineWarning(dd.id);
			}

			this.homey.app.updateLog(`Success sending command to ${dd.id} using API key`, 'hub');
			return result;
		}

		if (oAuth2Client)
		{
			await this.checkOfflineCooldown(dd.id, 'command');

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
						const baseDelay = 700 * (2 ** (attempt - 1));
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
				break;
			}

			if (this.isOfflineCode(responseCode))
			{
				throw await this.handleOfflineResponse(dd.id, responseCode, responseMessage, 'Command');
			}

			if (responseCode !== 100)
			{
				if (responseCode === 152)
				{
					this.homey.app.updateLog(`Failed to send command to ${dd.id} using OAuth: ${responseCode} ${responseMessage}`.trim(), 0, 'hub');
					throw new Error('Error: Device not found by SwitchBot');
				}
				else if (responseCode === 160)
				{
					this.homey.app.updateLog(`Failed to send command to ${dd.id} using OAuth: ${responseCode} ${responseMessage}`.trim(), 0, 'hub');
					throw new Error('Error: Command is not supported by SwitchBot');
				}
				else if (responseCode === 174)
				{
					this.homey.app.updateLog(`Failed to send command to ${dd.id} using OAuth: ${responseCode} ${responseMessage}`.trim(), 0, 'hub');
					throw new Error('Cloud option is not enabled in the SwitchBot app');
				}
				else if (responseCode === 190)
				{
					this.homey.app.updateLog(`Failed to send command to ${dd.id} using OAuth: ${responseCode} ${responseMessage}`.trim(), 0, 'hub');
					throw new Error(`Error: ${responseCode} ${responseMessage || 'Command rejected by SwitchBot'}, ${this.homey.app.varToString(data)}`);
				}
				else
				{
					this.homey.app.updateLog(`Failed to send command to ${dd.id} using OAuth: ${responseCode} ${responseMessage}`.trim(), 0, 'hub');
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
		throw new Error('No API key or OAuth client available. Re-authenticate in app settings to restore control.');
	}

	// Override this method to get the device values
	async getHubDeviceValues()
	{
		return null;
	}

	async _getHubDeviceValues()
	{
		if (this.homey.app.isRateLimited())
		{
			// Don't make the rate limit worse; the request would be rejected anyway
			throw new Error(this.homey.app.getRateLimitWarningText());
		}

		const dd = this.getData();
		await this.checkOfflineCooldown(dd.id, 'status request');
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

			if (this.isOfflineCode(data.statusCode))
			{
				throw await this.handleOfflineResponse(dd.id, data.statusCode, data.message, 'Status request');
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

			if (this.isOfflineCode(data.statusCode))
			{
				throw await this.handleOfflineResponse(dd.id, data.statusCode, data.message, 'Status request');
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

		return null;
	}

}

module.exports = HubDevice;
