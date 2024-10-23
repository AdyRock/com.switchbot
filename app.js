/* jslint node: true */

'use strict';

if (process.env.DEBUG === '1')
{
	// eslint-disable-next-line node/no-unsupported-features/node-builtins, global-require
	require('inspector').open(9224, '0.0.0.0', true);
}

const Homey = require('homey');
const { OAuth2App } = require('homey-oauth2app');
const nodemailer = require('nodemailer');
const HubInterface = require('./lib/hub_interface');
const BLEHubInterface = require('./lib/ble_hub_interface');
const SwitchBotOAuth2Client = require('./lib/SwitchBotOAuth2Client');

const MINIMUM_POLL_INTERVAL = 15; // in Seconds
const BLE_POLLING_INTERVAL = 30000; // in milliSeconds
class MyApp extends OAuth2App
{

	static OAUTH2_CLIENT = SwitchBotOAuth2Client; // Default: OAuth2Client
	static OAUTH2_DEBUG = false; // Default: false
	static OAUTH2_MULTI_SESSION = false; // Default: false
	static OAUTH2_DRIVERS = [
		'contact_hub',
		'air_con_hub',
		'bot_hub',
		'color_bulb_hub',
		'curtains_hub',
		'custom_remote_hub',
		'dvd',
		'fan_hub',
		'humidifier_hub',
		'light_remote_hub',
		'lock_hub',
		'presence_hub',
		'scene',
		'settop_box_hub',
		'smart_fan_hub',
		'speaker',
		'strip_light',
		'temperature_hub',
		'tv_hub',
		'blind_tilt_hub',
	]; // Default: all drivers

	/**
	 * onInit is called when the app is initialized.
	 */
	async onOAuth2Init()
	{
		this.log('SwitchBot has been initialized');
		this.homey.app.logLevel = this.homey.settings.get('logLevel');

		this.diagLog = '';
		this.homey.app.deviceStatusLog = '';
		this.openToken = this.homey.settings.get('openToken');
		this.openSecret = this.homey.settings.get('openSecret');
		this.blePolling = false;
		this.bleBusy = false;
		this.devicesMACs = [];
		this.webRegTimerID = null;

		this.apiCalls = this.homey.settings.get('apiCalls');
		if (!this.apiCalls)
		{
			this.apiCalls = 0;
		}

		// Set timer to reset the api counter at midnight
		if (this.apiCountReset)
		{
			clearTimeout(this.apiCountReset);
		}
		const nowTime = new Date(Date.now());
		let newTime = new Date(Date.now());
		newTime.setDate(nowTime.getDate() + 1);
		newTime.setHours(0);
		newTime.setMinutes(0);
		newTime -= nowTime;
		this.resetAPICount = this.resetAPICount.bind(this);
		const resestIn = newTime.valueOf();
		this.apiCountReset = this.homey.setTimeout(this.resetAPICount, resestIn);

		if (process.env.DEBUG === '1')
		{
			this.homey.settings.set('debugMode', true);
		}
		else
		{
			this.homey.settings.set('debugMode', false);
		}

		this.hub = new HubInterface(this.homey);

		this.homeyID = await this.homey.cloud.getHomeyId();
		this.setupSwitchBotWebhook();

		this.homeyHash = this.homeyID;
		this.homeyHash = this.hashCode(this.homeyHash).toString();

		this.logLevel = this.homey.settings.get('logLevel');
		if (this.logLevel === null)
		{
			this.logLevel = 0;
			this.homey.settings.set('logLevel', this.logLevel);
		}

		this.OAUTH2_DEBUG = (this.logLevel > 1);

		// Callback for app settings changed
		this.homey.settings.on('set', async function settingChanged(setting)
		{
			this.homey.app.updateLog(`Setting ${setting} has changed.`, 3);
			if (setting === 'logLevel')
			{
				this.homey.app.logLevel = this.homey.settings.get('logLevel');
				this.OAUTH2_DEBUG = (this.logLevel > 2);
			}
			else if (setting === 'openToken')
			{
				this.openToken = this.homey.settings.get('openToken');
			}
			else if (setting === 'openSecret')
			{
				this.openSecret = this.homey.settings.get('openSecret');
			}
		});

		// Set to true to enable use of my BLE hub (WIP)
		this.BLEHub = null;

		try
		{
			this.homeyIP = await this.homey.cloud.getLocalAddress();
			if (this.homeyIP)
			{
				this.BLEHub = new BLEHubInterface(this.homey, this.homeyIP);
			}
		}
		catch (err)
		{
			// Homey cloud or Bridge so no LAN access
			this.homeyIP = null;
		}

		this.onHubPoll = this.onHubPoll.bind(this);
		this.hubDevices = 0;
		this.timerHubID = null;

		this.onBLEPoll = this.onBLEPoll.bind(this);
		this.bleDevices = 0;
		this.bleTimerID = null;

		// Register flow cards

		const operateAction = this.homey.flow.getActionCard('operate_aircon');
		operateAction
			.registerRunListener(async (args, state) =>
			{
				// this.log('activate_instant_mode');
				return args.device.onCapabilityAll(args);
			});

		const onAction = this.homey.flow.getActionCard('on');
		onAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityCommand('turnOn');
			});

		const offAction = this.homey.flow.getActionCard('off');
		offAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityCommand('turnOff');
			});

		const muteAction = this.homey.flow.getActionCard('mute');
		muteAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityCommand('mute');
			});

		const playAction = this.homey.flow.getActionCard('play');
		playAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityCommand('play');
			});

		const startAction = this.homey.flow.getActionCard('start');
			startAction
				.registerRunListener(async (args, state) =>
				{
					return args.device.onCapabilityCommand('start');
				});

		const pauseAction = this.homey.flow.getActionCard('pause');
		pauseAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityCommand('pause');
			});

		const stopAction = this.homey.flow.getActionCard('stop');
		stopAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityCommand('stop');
			});

		const dockAction = this.homey.flow.getActionCard('dock');
			dockAction
				.registerRunListener(async (args, state) =>
				{
					return args.device.onCapabilityCommand('dock');
				});

		const prevAction = this.homey.flow.getActionCard('prev');
		prevAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityCommand('prev');
			});

		const nextAction = this.homey.flow.getActionCard('next');
		nextAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityCommand('next');
			});

		const setChannelAction = this.homey.flow.getActionCard('set_channel');
		setChannelAction
			.registerRunListener(async (args, state) =>
			{
				return args.device._operateDevice('SetChannel', args.channel_number.toString());
			});

		const rewindAction = this.homey.flow.getActionCard('rewind');
		rewindAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityCommand('rewind');
			});

		const forwardAction = this.homey.flow.getActionCard('forward');
		forwardAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityCommand('forward');
			});

		const startSceneAction = this.homey.flow.getActionCard('start_scene');
		startSceneAction
			.registerRunListener(async (args, state) =>
			{
				// this.log('activate_instant_mode');
				return args.device.onCapabilityStartScene();
			});

		const runSceneAction = this.homey.flow.getActionCard('run_scene');
		runSceneAction.registerRunListener(async (args, state) =>
		{
			await this.runScene(args.scene.data.id);
		});
		runSceneAction.registerArgumentAutocompleteListener('scene', async (query, args) =>
		{
			const results = await this.getScenes();
			if (query === '')
			{
				return results;
			}

			// filter based on the query
			return results.filter((result) =>
			{
				return result.name.toLowerCase().includes(query.toLowerCase());
			});
		});

		const nebulizationModeAction = this.homey.flow.getActionCard('nebulization_mode');
		nebulizationModeAction.registerRunListener(async (args, state) =>
		{
			return args.device.onCapabilityNebulization(args);
		});

		const nebulizationEfficiencyAction = this.homey.flow.getActionCard('nebulization_efficiency');
		nebulizationEfficiencyAction.registerRunListener(async (args, state) =>
		{
			return args.device.onCapabilityNebulization(args);
		});

		const smartFanAction = this.homey.flow.getActionCard('smart_fan_mode');
		smartFanAction.registerRunListener(async (args, state) =>
		{
			return args.device.onCapabilityFanSettings(args);
		});

		const fanSwingAction = this.homey.flow.getActionCard('fan_swing');
		fanSwingAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityCommand('swing');
			});

		const fanLowSpeedAction = this.homey.flow.getActionCard('fan_low_speed');
		fanLowSpeedAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityCommand('lowSpeed');
			});

		const fanMediumSpeedAction = this.homey.flow.getActionCard('fan_medium_speed');
		fanMediumSpeedAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityCommand('middleSpeed');
			});

		const fanHighSpeedAction = this.homey.flow.getActionCard('fan_high_speed');
		fanHighSpeedAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityCommand('highSpeed');
			});

		const sendRemoteCommandAction = this.homey.flow.getActionCard('send_custom_remote_command');
		sendRemoteCommandAction.registerRunListener(async (args, state) =>
		{
			return args.device.onCapabilityButtonPressed(args.command.id);
		});
		sendRemoteCommandAction.registerArgumentAutocompleteListener('command', async (query, args) =>
		{
			const results = await args.device.getButtonList();

			// filter based on the query
			return results.filter((result) =>
			{
				return result.name.toLowerCase().includes(query.toLowerCase());
			});
		});

		const brightnessDownAction = this.homey.flow.getActionCard('brightness_down');
		brightnessDownAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityCommand('brightnessDown');
			});

		const brightnessUpAction = this.homey.flow.getActionCard('brightness_up');
		brightnessUpAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityCommand('brightnessUp');
			});

		const tiltAction = this.homey.flow.getActionCard('windowcoverings_tilt_set');
		tiltAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityPosition(args.windowcoverings_tilt_set);
			});

		const vaccumPowerAction = this.homey.flow.getActionCard('set_vaccum_power');
		vaccumPowerAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityPowerLevel(parseInt(args.power, 10));
			});

		const windowCoversAction = this.homey.flow.getActionCard('windowcoverings_custom_set');
		windowCoversAction
		.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityPosition(args.percentage, args.speed);
			});

		/** * CONDITIONS ** */
		this.conditionVaccumStateIs = this.homey.flow.getConditionCard('vaccum_state_is.');
		this.conditionVaccumStateIs.registerRunListener((args) =>
		{
			const { device, state } = args;
			const conditionMet = (device.getCapabilityValue('robot_vaccum_state') === state);
			return Promise.resolve(conditionMet);
		});

		this.homey.app.updateLog('****** App has initialised. ******');
	}

	async onUninit()
	{
		await this.deleteSwitchBotWebhook();
	}

	resetAPICount()
	{
		this.apiCalls = 0;

		// Set timer to reset the count at midnight
		this.apiCountReset = this.homey.setTimeout(this.resetAPICount, 86400 * 1000);
	}

	hashCode(s)
	{
		let h = 0;
		for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
		return h;
	}

	varToString(source)
	{
		try
		{
			if (source === null)
			{
				return 'null';
			}
			if (source === undefined)
			{
				return 'undefined';
			}
			if (source instanceof Error)
			{
				const stack = source.stack.replace('/\\n/g', '\n');
				return `${source.message}\n${stack}`;
			}
			if (typeof (source) === 'object')
			{
				const getCircularReplacer = () =>
				{
					const seen = new WeakSet();
					return (key, value) =>
					{
						if (key.startsWith('_'))
						{
							return '...';
						}

						if (typeof value === 'object' && value !== null)
						{
							if (seen.has(value))
							{
								return '';
							}
							seen.add(value);
						}
						return value;
					};
				};

				return JSON.stringify(source, getCircularReplacer(), 2);
			}
			if (typeof (source) === 'string')
			{
				return source;
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`VarToString Error: ${err}`, 0);
		}

		return source.toString();
	}

	updateLog(newMessage, errorLevel = 2)
	{
		if (errorLevel <= this.homey.app.logLevel)
		{
			const nowTime = new Date(Date.now());

			this.diagLog += '\r\n* ';
			this.diagLog += nowTime.toJSON();
			this.diagLog += '\r\n';

			if (errorLevel === 0)
			{
				this.error(newMessage);
				this.diagLog += '!!!!!! ';
			}
			else
			{
				this.log(newMessage);
				this.diagLog += '* ';
			}
			this.diagLog += newMessage;
			this.diagLog += '\r\n';
			if (this.diagLog.length > 60000)
			{
				this.diagLog = this.diagLog.substr(this.diagLog.length - 60000);
			}

			if (this.homeyIP)
			{
				this.homey.api.realtime('com.switchbot.logupdated', { log: this.diagLog });
			}
		}
	}

	async sendLog(logType, replyAddress, deviceId, oAuth2Client)
	{
		let tries = 5;
		// this.log('Send Log');
		while (tries-- > 0)
		{
			try
			{
				let subject = '';
				let text = '';
				if (logType === 'infoLog')
				{
					subject = 'SwitchBot Information log';
					text = this.diagLog;
				}
				else if (logType === 'statusLog')
				{
					subject = 'SwitchBot Status log';
					text = this.deviceStatusLog;
				}
				else if (logType === 'deviceLog')
				{
					subject = 'SwitchBot device log';
					text = this.detectedDevices;
				}
				else
				{
					subject = 'SwitchBot Homey log';

					text = 'SwitchBot Information log\n\n';
					text += this.diagLog;

					text += '\n\n============================================\nSwitchBot detected devices log\n\n';
					text += await this.getHUBDevices();
					text += `\n\n============================================\nSwitchBot device Status ${deviceId}\n\n`;

					let retval = null;
					if (oAuth2Client)
					{
						const data = await oAuth2Client.getDeviceData(deviceId);
						retval = data.body;
					}
					else
					{
						retval = await this.getDeviceStatus(deviceId);
					}

					if (retval)
					{
						text += JSON.stringify(retval, null, 2);
					}
				}

				subject += `(${this.homeyHash} : ${Homey.manifest.version})`;

				// create reusable transporter object using the default SMTP transport
				const transporter = nodemailer.createTransport(
				{
					host: Homey.env.MAIL_HOST, // Homey.env.MAIL_HOST,
					port: 465,
					ignoreTLS: false,
					secure: true, // true for 465, false for other ports
					auth:
					{
						user: Homey.env.MAIL_USER, // generated ethereal user
						pass: Homey.env.MAIL_SECRET, // generated ethereal password
					},
					tls:
					{
						// do not fail on invalid certs
						rejectUnauthorized: false,
					},
				},
);

				// send mail with defined transport object
				const response = await transporter.sendMail(
				{
					from: `"Homey User" <${Homey.env.MAIL_USER}>`, // sender address
					to: Homey.env.MAIL_RECIPIENT, // list of receivers
					cc: replyAddress,
					subject, // Subject line
					text, // plain text body
				},
);

				return {
					error: response,
					message: 'OK',
				};
			}
			catch (err)
			{
				this.logInformation('Send log error', err);
				return {
					error: err,
					message: null,
				};
			}
		}

		return {
			error: 'Failed',
			message: 'Max tries',
		};
	}

	async Delay(period)
	{
		await new Promise((resolve) => this.homey.setTimeout(resolve, period));
	}

	//= ======================================================================================
	// BLEHub interface

	/// //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// SwitchBot Hub
	//
	async getDeviceStatus(deviceId)
	{
		const oAuth2Client = this.getFirstSavedOAuth2Client();
		if (oAuth2Client)
		{
			const response = await oAuth2Client.getDeviceData(deviceId);
			if (response)
			{
				if (response.statusCode !== 100)
				{
					this.homey.app.updateLog(`Invalid response code: ${response.statusCode} ${response.message}`);
					throw (new Error(`Invalid response code: ${response.statusCode} ${response.message}`));
				}

				return response.body;
			}
		}

		return this.hub.getDeviceData(deviceId);
	}

	// Clear the webhook URL from the SwitchBot account
	async deleteSwitchBotWebhook()
	{
		const oAuth2Client = this.getFirstSavedOAuth2Client();
		if (oAuth2Client)
		{
			oAuth2Client.deleteWebhook(Homey.env.WEBHOOK_URL);
		}
	}

	async processWebhookMessage(message)
	{
		this.updateLog(`Got a webhook message! ${this.varToString(message)}`, 1);
		const drivers = this.homey.drivers.getDrivers();
		for (const driver of Object.values(drivers))
		{
			const devices = driver.getDevices();
			for (const device of Object.values(devices))
			{
				if (device.processWebhookMessage)
				{
					try
					{
						await device.processWebhookMessage(message);
					}
					catch (err)
					{
						this.updateLog(`Error processing webhook message! ${err.message}`, 0);
					}
				}
			}
		}
	}

	async registerHomeyWebhook(DeviceMAC)
	{
		if (this.webRegTimerID)
		{
			this.homey.clearTimeout(this.webRegTimerID);
		}

		// See if the SwitchBot is already registered
		if (this.devicesMACs.findIndex((device) => device.localeCompare(DeviceMAC, 'en', { sensitivity: 'base' }) === 0) >= 0)
		{
			// Already registered
			return;
		}

		this.devicesMACs.push(DeviceMAC);

		// Delay the actual registration to allow other devices to initialise and do them all at once
		this.webRegTimerID = this.homey.setTimeout(() => this.doWebhookReg(), 2000);
	}

	async doWebhookReg()
	{
		this.webRegTimerID = null;
		const data = {
			$keys: this.devicesMACs,
		};

		// Setup the webhook call back to receive push notifications
		const id = Homey.env.WEBHOOK_ID;
		const secret = Homey.env.WEBHOOK_SECRET;

		if (this.homeyWebhook)
		{
			// Unregister the existing webhook
			try
			{
				await this.homeyWebhook.unregister();
				this.homeyWebhook = null;
			}
			catch (err)
			{
				this.updateLog(`Homey Webhook failed to unregister, Error: ${err.message}`, 0);

				// Try again later
				if (!this.webRegTimerID)
				{
					this.webRegTimerID = this.homey.setTimeout(() => this.doWebhookReg(), 2000);
				}
				return;
			}
		}

		try
		{
			this.homeyWebhook = await this.homey.cloud.createWebhook(id, secret, data);

			this.homeyWebhook.on('message', async (args) =>
			{
				try
				{
					await this.processWebhookMessage(args.body);
				}
				catch (err)
				{
					this.updateLog(`Homey Webhook message error: ${err.message}`, 1);

					// Try again later
					if (!this.webRegTimerID)
					{
						this.webRegTimerID = this.homey.setTimeout(() => this.doWebhookReg(), 2000);
					}
				}
			});

			this.updateLog(`Homey Webhook registered for devices ${this.homey.app.varToString(data)}`, 1);
		}
		catch (err)
		{
			this.updateLog(`Homey Webhook registration failed for devices ${this.homey.app.varToString(data)}, Error: ${err.message}`, 0);

			// Try again later
			if (!this.webRegTimerID)
			{
				this.webRegTimerID = this.homey.setTimeout(() => this.doWebhookReg(), 2000);
			}
		}
	}

	async setupSwitchBotWebhook()
	{
		try
		{
			// Fetch the first OAuth client to use for checking / setting webhook
			const oAuth2Client = this.getFirstSavedOAuth2Client();
			if (oAuth2Client)
			{
				// Fetch any exitsing webhook
				const response1 = await oAuth2Client.getWebhook();
				if (response1)
				{
					if (response1.statusCode === 100)
					{
						// We got a valid response so make sure it is the correct webhook
						if (response1.body.urls[0].localeCompare(Homey.env.WEBHOOK_URL, 'en', { sensitivity: 'base' }) === 0)
						{
							this.homey.app.updateLog('SwitchBot webhook already registered', 1);
							return;
						}

						// Delete the current web hook so we can replace it with ours
						const response2 = await oAuth2Client.deleteWebhook(response1.body.urls[0]);
						if (response2)
						{
							if (response2.statusCode !== 100)
							{
								this.homey.app.updateLog(`Delete webhook: ${response1.body.urls[0]}\nInvalid response code: ${response2.statusCode}\nMessage: ${response2.message}`, 0);
								return;
							}

							this.homey.app.updateLog(`Deleted old webhook: ${response1.body.urls[0]}`, 3);
						}
					}
				}

				const response = await oAuth2Client.setWebhook(Homey.env.WEBHOOK_URL);
				if (response)
				{
					if (response.statusCode !== 100)
					{
						this.homey.app.updateLog(`Invalid response code: ${response.statusCode}\nMessage: ${response.message}`, 0);
						return;
					}
					this.homey.app.updateLog('Registered SwitchBot webhook', 1);
					return;
				}
				this.homey.app.updateLog('No response when registering the SwitchBot webhook', 0);
				return;
			}

			this.homey.app.updateLog('No OAuth client available to register the SwitchBot webhook', 0);
	}
		catch (err)
		{
			this.homey.app.updateLog(`Invalid response: ${err.message}`, 0);
		}
	}

	async getHUBDevices()
	{
		// Find an OAuth session
		try
		{
			const oAuth2Client = this.getFirstSavedOAuth2Client();
			if (oAuth2Client)
			{
				const response = await oAuth2Client.getDevices();
				if (response)
				{
					if (response.statusCode !== 100)
					{
						this.homey.app.updateLog(`Invalid response code: ${response.statusCode} ${response.message}`, 0);
						throw (new Error(`Invalid response code: ${response.statusCode} ${response.message}`));
					}

					const devices = response.body;
					const scenes = await oAuth2Client.getScenes();
					if (scenes)
					{
						devices.sceneList = scenes.body;
					}
					return this.homey.app.varToString(devices);
				}
			}
		}
		catch (err)
		{
		}

		const response = await this.hub.getDevices();
		return response;
	}

	async runScene(id)
	{
		const oAuth2Client = this.getFirstSavedOAuth2Client();
		if (oAuth2Client)
		{
			const retData = await oAuth2Client.startScene(id);
			return retData.body;
		}

		return this.hub.startScene(id);
	}

	async getScenes()
	{
		// Find an OAuth session
		const oAuth2Client = this.getFirstSavedOAuth2Client();
		if (oAuth2Client)
		{
			const response = await oAuth2Client.getScenes();
			if (response.statusCode !== 100)
			{
				this.homey.app.updateLog(`Invalid response code: ${response.statusCode}`, 0);
				throw (new Error(`Invalid response code: ${response.statusCode}`));
			}

			const searchData = response.body;
			const scenes = [];

			// Create an array of devices
			for (const scene of searchData)
			{
				// Add this scene to the table
				let data = {};
				data = {
					id: scene.sceneId,
				};

				// Add this device to the table
				scenes.push(
					{
						name: scene.sceneName,
						data,
					},
				);
			}
			return scenes;
		}

		return this.hub.getScenes();
	}

	registerHUBPolling()
	{
		this.hubDevices++;
		if (this.timerHubID === null)
		{
			this.timerHubID = this.homey.setTimeout(this.onHubPoll, 1000);
		}
	}

	unregisterHUBPolling()
	{
		this.hubDevices--;
		if ((this.hubDevices === 0) && (this.timerHubID !== null))
		{
			this.homey.clearTimeout(this.timerHubID);
			this.timerHubID = null;
		}
	}

	async onHubPoll()
	{
		this.homey.app.updateLog(`Polling hub: ${this.homey.app.apiCalls} API calls today`);
		if (this.timerHubID)
		{
			this.homey.clearTimeout(this.timerHubID);
			this.timerHubID = null;
		}

		let totalHuBDevices = 0;

		const drivers = this.homey.drivers.getDrivers();
		for (const driver of Object.values(drivers))
		{
			const devices = driver.getDevices();
			for (const device of Object.values(devices))
			{
				if (device.pollHubDeviceValues)
				{
					if (await device.pollHubDeviceValues())
					{
						totalHuBDevices++;
					}
				}
			}
		}

		if (totalHuBDevices > 0)
		{
			const nextInterval = (MINIMUM_POLL_INTERVAL * 1000 * totalHuBDevices);

			this.homey.app.updateLog(`Next HUB polling interval = ${nextInterval / 1000}s: ${this.homey.app.apiCalls} API calls today`);
			this.timerHubID = this.homey.setTimeout(this.onHubPoll, nextInterval);
			// this.timerHubID = this.homey.setTimeout(this.onHubPoll, MINIMUM_POLL_INTERVAL * 1000);
		}
	}

	registerBLEPolling()
	{
		this.bleDevices++;
		if (this.bleTimerID === null)
		{
			this.bleTimerID = this.homey.setTimeout(this.onBLEPoll, BLE_POLLING_INTERVAL);
		}
	}

	unregisterBLEPolling()
	{
		this.bleDevices--;
		if ((this.bleDevices === 0) && (this.bleTimerID !== null))
		{
			this.homey.clearTimeout(this.bleTimerID);
			this.bleTimerID = null;
		}
	}

	/// ////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Homey BLE
	//
	async onBLEPoll()
	{
		if (!this.bleBusy)
		{
			this.bleBusy = true;
			this.blePolling = true;
			this.updateLog('\r\n------ Polling BLE Starting ------');

			const promises = [];
			try
			{
				// Run discovery too fetch new data
				await this.homey.ble.discover(['cba20d00224d11e69fb80002a5d5c51b'], 2000);
				this.updateLog('BLE Finished Discovery');

				// eslint-disable-next-line no-restricted-syntax
				const drivers = this.homey.drivers.getDrivers();
				for (const driver of Object.values(drivers))
				{
					const devices = driver.getDevices();
					for (const device of Object.values(devices))
					{
						if (device.getDeviceValues)
						{
							promises.push(device.getDeviceValues());
						}
					}
				}

				this.updateLog('Polling BLE: waiting for devices to update');
				await Promise.all(promises);
			}
			catch (err)
			{
				this.updateLog(`BLE Polling Error: ${err.message}`);
			}

			this.blePolling = false;
			this.bleBusy = false;
			this.updateLog('------ Polling BLE Finished ------\r\n');
		}
		else
		{
			this.updateLog('Polling BLE skipped while discovery in progress\r\n');
		}

		this.updateLog(`Next BLE polling interval = ${BLE_POLLING_INTERVAL}`);

		this.bleTimerID = this.homey.setTimeout(this.onBLEPoll, BLE_POLLING_INTERVAL);
	}

}

module.exports = MyApp;
