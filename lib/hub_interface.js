/* eslint-disable camelcase */
/* jslint node: true */

'use strict';

const crypto = require('crypto');
const https = require('https');

// Utility file to interface to the SwitchBot hub
class hub_interface
{

	constructor(HomeyInstance)
	{
		this.homey = HomeyInstance;
		return this;
	}

	async getScenes()
	{
		// https://api.switch-bot.com/v1.0/scenes
		const url = 'scenes';
		const response = await this.GetURL(url);
		if (response)
		{
			if (response.statusCode && response.statusCode !== 100)
			{
				this.homey.app.updateLog(`Invalid response code: ${response.statusCode}`, 0, 'hub');
				throw (new Error(`Invalid response code: ${response.statusCode}`));
			}

			const searchData = response.body;
			this.homey.app.detectedDevices = this.homey.app.varToString(searchData);
			if (this.homey.app.BLEHub)
			{
				this.homey.api.realtime('com.switchbot.detectedDevicesUpdated', { devices: this.homey.app.detectedDevices });
			}

			const devices = [];

			if (Array.isArray(searchData))
			{
				// Create an array of devices
				for (const device of searchData)
				{
					this.homey.app.updateLog('Found device: ', 'hub');
					this.homey.app.updateLog(device, 'hub');

					let data = {};
					data = {
						id: device.sceneId,
					};

					// Add this device to the table
					devices.push(
						{
							name: device.sceneName,
							data,
						},
					);
				}
			}
			return devices;
		}

		this.homey.app.updateLog('Getting API Key returned NULL', 0, 'hub');
		throw (new Error('HTTPS Error: Nothing returned'));
	}

	async getDevices()
	{
		// https://api.switch-bot.com/v1/devices
		const url = 'devices';
		const response = await this.GetURL(url);
		if (response)
		{
			if (response.statusCode !== 100)
			{
				this.homey.app.updateLog(`Invalid response code: ${response.statusCode}\nMessage: ${response.message}`, 0, 'hub');
				throw (new Error(response.message));
			}

			return response;
		}

		this.homey.app.updateLog('Invalid response: No data', 0, 'hub');
		throw (new Error('Invalid response: No data'));
	}

	async getDeviceData(deviceId)
	{
		// https://api.switch-bot.com/v1/devices/deviceId/status
		const url = `devices/${deviceId}/status`;
		const response = await this.GetURL(url);

		return response;
	}

	async setDeviceData(deviceId, body)
	{
		// https://api.switch-bot.com/v1/devices/commands
		const url = `devices/${deviceId}/commands`;
		const response = await this.PostURL(url, body);
		if (response)
		{
			if (response.statusCode !== 100)
			{
				this.homey.app.updateLog(`Invalid response code: ${response.statusCode}:\nMessage: ${response.message}`, 0, 'hub');
				throw (new Error(response.message));
			}

			return true;
		}

		this.homey.app.updateLog('Invalid response: No data', 0, 'hub');
		throw (new Error('Invalid response: No data'));
	}

	async startScene(deviceId)
	{
		const url = `scenes/${deviceId}/execute`;
		const response = await this.PostURL(url);
		if (response)
		{
			if (response.statusCode !== 100)
			{
				this.homey.app.updateLog(`Invalid response code: ${response.statusCode}:\nMessage: ${response.message}`, 0, 'hub');
				throw (new Error(response.message));
			}

			return true;
		}

		this.homey.app.updateLog('Invalid response: No data', 0, 'hub');
		throw (new Error('Invalid response: No data'));
	}

	async GetURL(url)
	{
		if ((process.env.DEBUG === '1') && (url === 'devices'))
		{
			const simData = this.homey.settings.get('simData');
			if (simData)
			{
				try
				{
					const bodyJSON = JSON.parse(simData);
					return { body: bodyJSON, statusCode: 100 };
				}
				catch (err)
				{
					this.homey.app.updateLog(`Invalid simulated data: ${err.message}`, 0, 'hub');
					throw new Error(`Invalid simulated data: ${err.message}`);
				}
			}
		}

		this.homey.app.updateLog(url, 'hub');

		return new Promise((resolve, reject) =>
		{
			try
			{
				if (!this.homey.app.openToken)
				{
					reject(new Error('Invalid Token.'));
					return;
				}

				if (!this.homey.app.openSecret)
				{
					reject(new Error('Invalid Secret.'));
					return;
				}

				const t = Date.now();
				const nonce = this.getRandomId();
				const data = this.homey.app.openToken + t + nonce;
				const signTerm = crypto.createHmac('sha256', this.homey.app.openSecret)
					.update(Buffer.from(data, 'utf-8'))
					.digest();
				const sign = signTerm.toString('base64');

				const httpsOptions = {
					host: 'api.switch-bot.com',
					port: 443,
					path: `/v1.1/${url}`,
					headers:
					{
						Authorization: this.homey.app.openToken,
						sign,
						nonce,
						t,
						'Content-Type': 'application/json',
					},
				};

				if (this.homey && this.homey.app && this.homey.app.incrementApiCalls)
				{
					this.homey.app.incrementApiCalls();
				}

				https.get(httpsOptions, (res) =>
				{
					if (res.statusCode === 200)
					{
						const body = [];
						res.on('data', (chunk) =>
						{
							body.push(chunk);
						});
						res.on('end', () =>
						{
							try
							{
								const returnData = JSON.parse(Buffer.concat(body));
								this.homey.app.updateLog(`Get response: ${this.homey.app.varToString(returnData)}`, 3, 'hub');
								resolve(returnData);
							}
							catch (err)
							{
								reject(new Error(`Invalid JSON response: ${err.message}`));
							}
						});
					}
					else
					{
						let message = '';
						if (res.statusCode === 204)
						{
							message = 'No Data Found';
						}
						else if (res.statusCode === 400)
						{
							message = 'Bad request';
						}
						else if (res.statusCode === 401)
						{
							message = 'Unauthorized';
						}
						else if (res.statusCode === 403)
						{
							message = 'Forbidden';
						}
						else if (res.statusCode === 404)
						{
							message = 'Not Found';
						}
						this.homey.app.updateLog(`HTTPS Error: ${res.statusCode}: ${message}`, 0, 'hub');
						reject(new Error(`HTTPS Error: ${message}`));
					}
				}).on('error', (err) =>
				{
					this.homey.app.updateLog(err.message, 0, 'hub');
					reject(new Error(`HTTPS On Error: ${err.message}`));
				});
			}
			catch (err)
			{
				this.homey.app.updateLog(err.message, 0, 'hub');
				reject(new Error(`HTTPS Catch: ${err.message}`));
			}
		});
	}

	async PostURL(url, body)
	{
		if (body === undefined)
		{
			body = '';
		}

		this.homey.app.updateLog(url, 'hub');
		const bodyText = JSON.stringify(body);
		this.homey.app.updateLog(bodyText, 'hub');

		return new Promise((resolve, reject) =>
		{
			try
			{
				if (!this.homey.app.openToken)
				{
					reject(new Error('Invalid Token.'));
					return;
				}
				if (!this.homey.app.openSecret)
				{
					reject(new Error('Invalid Secret.'));
					return;
				}

				const t = Date.now();
				const nonce = this.getRandomId();
				const data = this.homey.app.openToken + t + nonce;
				const signTerm = crypto.createHmac('sha256', this.homey.app.openSecret)
					.update(Buffer.from(data, 'utf-8'))
					.digest();
				const sign = signTerm.toString('base64');

				const safeUrl = encodeURI(url);

				const httpsOptions = {
					host: 'api.switch-bot.com',
					path: `/v1.0/${safeUrl}`,
					port: 443,
					method: 'POST',
					headers:
					{
						Authorization: this.homey.app.openToken,
						sign,
						nonce,
						t,
						'Content-Type': 'application/json',
						'Content-Length': bodyText.length,
					},
				};

				if (this.homey && this.homey.app && this.homey.app.incrementApiCalls)
				{
					this.homey.app.incrementApiCalls();
				}

				this.homey.app.updateLog(this.homey.app.varToString(httpsOptions), 'hub');

				const req = https.request(httpsOptions, (res) =>
				{
					if (res.statusCode === 200)
					{
						const body = [];
						res.on('data', (chunk) =>
						{
							this.homey.app.updateLog('Post: retrieve data', 'hub');
							body.push(chunk);
						});
						res.on('end', () =>
						{
							try
							{
								const returnData = JSON.parse(Buffer.concat(body));
								this.homey.app.updateLog(`Post response: ${this.homey.app.varToString(returnData)}`, 'hub');
								resolve(returnData);
							}
							catch (err)
							{
								reject(new Error(`Invalid JSON response: ${err.message}`));
							}
						});
					}
					else
					{
						let message = '';
						if (res.statusCode === 204)
						{
							message = 'No Data Found';
						}
						else if (res.statusCode === 400)
						{
							message = 'Bad request';
						}
						else if (res.statusCode === 401)
						{
							message = 'Unauthorized';
						}
						else if (res.statusCode === 403)
						{
							message = 'Forbidden';
						}
						else if (res.statusCode === 404)
						{
							message = 'Not Found';
						}
						else if (res.statusCode === 174)
						{
							message = 'Cloud option is not enabled in the SwitchBot app';
						}
						this.homey.app.updateLog(`HTTPS Error: ${res.statusCode}: ${message}`, 0, 'hub');
						reject(new Error(`HTTPS Error: ${message}`));
					}
				}).on('error', (err) =>
				{
					this.homey.app.updateLog(err.message, 0, 'hub');
					reject(new Error(`HTTPS On Error: ${err.message}`));
				});
				req.write(bodyText);
				req.end();
			}
			catch (err)
			{
				this.homey.app.updateLog(err.message, 0, 'hub');
				reject(new Error(`HTTPS Catch: ${err.message}`));
			}
		});
	}

	getRandomId()
	{
		return 'xxxxxxxx-xxxx-5xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) =>
		{
			const r = Math.random() * 16 | 0; const
				// eslint-disable-next-line no-mixed-operators
				v = c === 'x' ? r : (r & 0x3 | 0x8);
			return v.toString(16);
		});
	}

}

module.exports = hub_interface;
