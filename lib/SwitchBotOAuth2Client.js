/* jslint node: true */

'use strict';

const Homey = require('homey');

// const Homey = require('homey');
const { OAuth2Client, OAuth2Error } = require('homey-oauth2app');
const { OAuth2Token } = require('homey-oauth2app');

module.exports = class SwitchBotOAuth2Client extends OAuth2Client
{

	// Required: CLIENT_ID and CLIENT_SECRET are inherited from OAuth2Client base class (reads from Homey.env)
	static API_URL = 'https://api.switch-bot.com/v1.1';
	static TOKEN_URL = 'https://account.api.switchbot.net/merchant/v1/oauth/token';
	static AUTHORIZATION_URL = 'https://sp.oauth.switchbot.net/';
	static SCOPES = ['phone', 'openid', 'email', 'profile'];

	// Optional:
	static TOKEN = OAuth2Token; // Default: OAuth2Token
	static REDIRECT_URL = 'https://callback.athom.com/oauth2/callback'; // Default: 'https://callback.athom.com/oauth2/callback'

	// Overload what needs to be overloaded here

	async onHandleNotOK({ statusText })
	{
		throw new OAuth2Error(this.formatRateLimitMessage(statusText));
	}

	countApiCall()
	{
		if (this.homey && this.homey.app && this.homey.app.incrementApiCalls)
		{
			this.homey.app.incrementApiCalls();
		}
	}

	formatRateLimitMessage(message)
	{
		const rawMessage = message ? String(message) : 'Unknown error';
		const isRateLimitError = /rate\s*limit|too\s*many\s*requests|\b429\b/i.test(rawMessage);
		if (!isRateLimitError)
		{
			return rawMessage;
		}

		if (/API calls/i.test(rawMessage))
		{
			return rawMessage;
		}

		const apiCalls = (this.homey && this.homey.app) ? this.homey.app.getAPICount() : null;
		if (typeof apiCalls === 'number')
		{
			return `${rawMessage} (${apiCalls} API calls)`;
		}

		return rawMessage;
	}

	async getDevices()
	{
		this.countApiCall();
		return this.get(
			{
				path: '/devices',
			},
		);
	}

	async getScenes()
	{
		this.countApiCall();
		return this.get(
			{
				path: '/scenes',
			},
		);
	}

	async getDeviceData(deviceId)
	{
		this.countApiCall();
		return this.get(
			{
				path: `/devices/${deviceId}/status`,
			},
		);
	}

	async setDeviceData(deviceId, data)
	{
		this.countApiCall();
		return this.post(
			{
				path: `/devices/${deviceId}/commands`,
				json: data,
			},
		);
	}

	async startScene(deviceId)
	{
		this.countApiCall();
		return this.post(
			{
				path: `/scenes/${deviceId}/execute`,
			},
		);
	}

	async setWebhook(url)
	{
		this.countApiCall();
		const data = {
			action: 'setupWebhook',
			url,
			deviceList: 'ALL',
		};

		return this.post(
			{
				path: '/webhook/setupWebhook',
				json: data,
			},
		);
	}

	async getWebhook()
	{
		this.countApiCall();
		const data = {
			action: 'queryUrl',
		};

		return this.post(
			{
				path: '/webhook/queryWebhook',
				json: data,
			},
		);
	}

	async deleteWebhook(url)
	{
		this.countApiCall();
		const data = {
			action: 'deleteWebhook',
			url,
		};

		return this.post(
			{
				path: '/webhook/deleteWebhook',
				json: data,
			},
		);
	}

	async onBuildRequest({ method, path, json, body, query, headers = {} })
	{
		const apiCount = (this.homey && this.homey.app) ? this.homey.app.getAPICount() : null;
		headers['User-Agent'] = Homey.env.USER_AGENT_HEADER;
		if (this.homey && this.homey.app && this.homey.app.updateLog)
		{
			this.homey.app.updateLog(`OAuth2 ${method} ${path} (API calls: ${apiCount})`, 2);
		}

		return super.onBuildRequest({ method, path, json, body, query, headers });
	}

	async onHandleResult({ result, status, statusText, headers })
	{
		if (this.homey && this.homey.app && this.homey.app.updateLog)
		{
			const remaining = headers.get ? headers.get('x-ratelimit-remaining') : (headers['x-ratelimit-remaining'] || null);
			if (remaining !== null && remaining !== undefined)
			{
				this.homey.app.updateLog(`OAuth2 response ${status}: x-ratelimit-remaining=${remaining}`, 2);
			}
		}

		return super.onHandleResult({ result, status, statusText, headers });
	}

	async onRefreshToken(...args)
	{
		if (this.homey && this.homey.app && this.homey.app.updateLog)
		{
			this.homey.app.updateLog('OAuth2 refresh_token request started', 2);
		}

		try
		{
			const token = await super.onRefreshToken(...args);
			if (this.homey && this.homey.app && this.homey.app.updateLog)
			{
				this.homey.app.updateLog('OAuth2 refresh_token request succeeded', 2);
			}
			return token;
		}
		catch (err)
		{
			if (this.homey && this.homey.app && this.homey.app.updateLog)
			{
				this.homey.app.updateLog(`OAuth2 refresh_token request failed: ${err.message}`, 0);
			}
			throw err;
		}
	}

	async onHandleRefreshTokenResponse({ response })
	{
		if (this.homey && this.homey.app && this.homey.app.updateLog)
		{
			const remaining = response && response.headers && response.headers.get ? response.headers.get('x-ratelimit-remaining') : null;
			if (remaining !== null && remaining !== undefined)
			{
				this.homey.app.updateLog(`OAuth2 refresh_token response: x-ratelimit-remaining=${remaining}`, 2);
			}
		}

		return super.onHandleRefreshTokenResponse({ response });
	}

	async onHandleRefreshTokenError({ response })
	{
		if (this.homey && this.homey.app && this.homey.app.updateLog)
		{
			const status = response ? response.status : 'unknown';
			const statusText = response ? response.statusText : 'unknown';
			this.homey.app.updateLog(`OAuth2 refresh_token HTTP error: ${status} ${statusText}`, 0);
		}

		return super.onHandleRefreshTokenError({ response });
	}

	async onGetTokenByCode({ code })
	{
		if (this.homey && this.homey.app && this.homey.app.updateLog)
		{
			this.homey.app.updateLog('OAuth2 authorization_code token request started', 2);
		}

		try
		{
			const token = await super.onGetTokenByCode({ code });
			if (this.homey && this.homey.app && this.homey.app.updateLog)
			{
				this.homey.app.updateLog('OAuth2 authorization_code token request succeeded', 2);
			}
			return token;
		}
		catch (err)
		{
			if (this.homey && this.homey.app && this.homey.app.updateLog)
			{
				this.homey.app.updateLog(`OAuth2 authorization_code token request failed: ${err.message}`, 0);
			}
			throw err;
		}
	}

	async onHandleGetTokenByCodeResponse({ response })
	{
		if (this.homey && this.homey.app && this.homey.app.updateLog)
		{
			const remaining = response && response.headers && response.headers.get ? response.headers.get('x-ratelimit-remaining') : null;
			if (remaining !== null && remaining !== undefined)
			{
				this.homey.app.updateLog(`OAuth2 authorization_code response: x-ratelimit-remaining=${remaining}`, 2);
			}
		}

		return super.onHandleGetTokenByCodeResponse({ response });
	}

	async onHandleGetTokenByCodeError({ response })
	{
		if (this.homey && this.homey.app && this.homey.app.updateLog)
		{
			const status = response ? response.status : 'unknown';
			const statusText = response ? response.statusText : 'unknown';
			this.homey.app.updateLog(`OAuth2 authorization_code HTTP error: ${status} ${statusText}`, 0);
		}

		return super.onHandleGetTokenByCodeError({ response });
	}

	async onGetTokenByCredentials({ username, password })
	{
		if (this.homey && this.homey.app && this.homey.app.updateLog)
		{
			this.homey.app.updateLog('OAuth2 password token request started', 2);
		}

		try
		{
			const token = await super.onGetTokenByCredentials({ username, password });
			if (this.homey && this.homey.app && this.homey.app.updateLog)
			{
				this.homey.app.updateLog('OAuth2 password token request succeeded', 2);
			}
			return token;
		}
		catch (err)
		{
			if (this.homey && this.homey.app && this.homey.app.updateLog)
			{
				this.homey.app.updateLog(`OAuth2 password token request failed: ${err.message}`, 0);
			}
			throw err;
		}
	}

	async onHandleGetTokenByCredentialsResponse({ response })
	{
		if (this.homey && this.homey.app && this.homey.app.updateLog)
		{
			const remaining = response && response.headers && response.headers.get ? response.headers.get('x-ratelimit-remaining') : null;
			if (remaining !== null && remaining !== undefined)
			{
				this.homey.app.updateLog(`OAuth2 password response: x-ratelimit-remaining=${remaining}`, 2);
			}
		}

		return super.onHandleGetTokenByCredentialsResponse({ response });
	}

	async onHandleGetTokenByCredentialsError({ response })
	{
		if (this.homey && this.homey.app && this.homey.app.updateLog)
		{
			const status = response ? response.status : 'unknown';
			const statusText = response ? response.statusText : 'unknown';
			this.homey.app.updateLog(`OAuth2 password HTTP error: ${status} ${statusText}`, 0);
		}

		return super.onHandleGetTokenByCredentialsError({ response });
	}

	debug(...args)
	{
		// Route debug calls through app.updateLog to avoid Homey's prefix [log] [MyApp] [dbg] etc.
		if (this.homey && this.homey.app && this.homey.app.updateLog)
		{
			const message = args.map(arg => {
				if (typeof arg === 'object')
				{
					try
					{
						return JSON.stringify(arg);
					}
					catch (e)
					{
						return String(arg);
					}
				}
				return String(arg);
			}).join(' ');

			this.homey.app.updateLog(message, 3); // level 3 = debug
		}
	}

	async _executeRequest(req, didRefreshToken = false)
	{
		// Intercept to redact Authorization header in debug output
		// Create a copy of req.opts with sanitized headers for logging
		const originalDebug = this.debug.bind(this);
		const sanitizedHeaders = {};

		// Build sanitized headers for logging
		if (req.opts && req.opts.headers)
		{
			for (const key of Object.keys(req.opts.headers))
			{
				if (key.toLowerCase() === 'authorization')
				{
					const authValue = req.opts.headers[key];
					if (typeof authValue === 'string' && authValue.startsWith('Bearer '))
					{
						sanitizedHeaders[key] = 'Bearer ***';
					}
					else
					{
						sanitizedHeaders[key] = '***';
					}
				}
				else
				{
					sanitizedHeaders[key] = req.opts.headers[key];
				}
			}
		}

		// Override debug temporarily to use sanitized headers
		this.debug = function(label, ...args)
		{
			// If this is a header log entry for Authorization, use sanitized value
			if (label === '[req]' && args.length > 0 && typeof args[0] === 'string')
			{
				const headerLine = args[0];
				if (headerLine.toLowerCase().startsWith('authorization:'))
				{
					const key = Object.keys(sanitizedHeaders).find(k => k.toLowerCase() === 'authorization');
					if (key)
					{
						return originalDebug(label, `${key}: ${sanitizedHeaders[key]}`);
					}
				}
			}
			return originalDebug(label, ...args);
		};

		try
		{
			return await super._executeRequest(req, didRefreshToken);
		}
		finally
		{
			// Restore original debug
			this.debug = originalDebug;
		}
	}

};
