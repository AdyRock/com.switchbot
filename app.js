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

	overrideLoggingMethods()
	{
		// Store original console methods to restore later
		this.originalLog = console.log;
		this.originalError = console.error;
		this.originalWarn = console.warn;
		this.originalInfo = console.info;

		console.log = (message, ...optionalParams) =>
		{
			if (this.handleLogMessage(message, ...optionalParams))
			{
				this.originalLog.apply(console, [message, ...optionalParams]);
			}
		};

		console.error = (message, ...optionalParams) =>
		{
			if (this.handleLogMessage(message, ...optionalParams))
			{
				this.originalError.apply(console, [message, ...optionalParams]);
			}
		};

		console.warn = (message, ...optionalParams) =>
		{
			if (this.handleLogMessage(message, ...optionalParams))
			{
				this.originalWarn.apply(console, [message, ...optionalParams]);
			}
		};

		console.info = (message, ...optionalParams) =>
		{
			if (this.handleLogMessage(message, ...optionalParams))
			{
				this.originalInfo.apply(console, [message, ...optionalParams]);
			}
		};
	}

	restoreLoggingMethods()
	{
		if (this.originalLog)
		{
			console.log = this.originalLog;
			console.error = this.originalError;
			console.warn = this.originalWarn;
			console.info = this.originalInfo;
		}
	}

	handleLogMessage(message, ...optionalParams)
	{
		const logMessage = `${optionalParams.join(' ')}`;
		// if the logMessage contains 'User-Agent' then replace the user-agent value with '***'
		if (logMessage.includes('User-Agent:'))
		{
			const logMessageArray = logMessage.split(' ');
			const userAgentIndex = logMessageArray.findIndex((element) => element === 'User-Agent:');
			if (userAgentIndex !== -1)
			{
				logMessageArray[userAgentIndex + 2] = '***';
			}
			this.updateLog(logMessageArray.join(' '), 2);
			return true;
		}

		this.updateLog(logMessage, 2);
		return true;
	}

	static OAUTH2_CLIENT = SwitchBotOAuth2Client; // Default: OAuth2Client
	static OAUTH2_DEBUG = true; // Default: false
	static OAUTH2_MULTI_SESSION = false; // Default: false
	static OAUTH2_DRIVERS = [
		'air_con_hub',
		'air_puifier_hub',
		'blind_tilt_hub',
		'bot_hub',
		'camera_hub',
		'camera_plus_hub',
		'color_bulb_hub',
		'contact_hub',
		'curtains_hub',
		'custom_remote_hub',
		'dvd',
		'fan_hub',
		'hub3',
		'humidifier_hub',
		'humidifier2_hub',
		'light_remote_hub',
		'lock_hub',
		"lock_ultra_hub",
		'meter_pro_CO2_hub',
		'meter_pro_hub',
		'plug_eu_hub',
		'plug_hub',
		'presence_hub',
		'relay_hub',
		'relay2pm_hub',
		'robot_vacuum_hub',
		'robot_vacuum_K20_hub',
		'robot_vacuum_S10_hub',
		'roller_blind_hub',
		'S10_water_station',
		'scene',
		'settop_box_hub',
		'smart_fan_hub',
		'speaker',
		'strip_light',
		'temperature_hub',
		'tv_hub',
		'water_leak_hub',
	];

	/**
	 * onInit is called when the app is initialized.
	 */
	async onOAuth2Init()
	{
		this.overrideLoggingMethods();

		this.log('SwitchBot has been initialized');
		this.logLevel = this.homey.settings.get('logLevel');
		if (this.logLevel === null)
		{
			this.logLevel = 0;
			this.homey.settings.set('logLevel', this.logLevel);
		}

		this.diagLog = '';
		this.deviceStatusLog = '';
		this.openToken = this.homey.settings.get('openToken');
		this.openSecret = this.homey.settings.get('openSecret');
		this.blePolling = false;
		this.bleBusy = false;
		this.devicesMACs = [];
		this.webRegTimerID = null;

		if (this.logLevel > 1)
		{
			this.enableOAuth2Debug();
		}
		else
		{
			this.disableOAuth2Debug();
		}

		this.processWebhookMessage.bind(this);

		this.numConnections = this.homey.settings.get('numConnections');
		if (!this.numConnections)
		{
			this.numConnections = 1;
			this.homey.settings.set('numConnections', this.numConnections);
		}

		this.apiCalls = this.homey.settings.get('apiCalls');
		if (!this.apiCalls)
		{
			this.apiCalls = 0;
		}

		// Set timer to reset the api counter at midnight
		if (this.apiCountReset)
		{
			this.homey.clearTimeout(this.apiCountReset);
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

		// Setup the SwitchBot webhook after a short delay to allow devices to register
		this.homey.setTimeout(() => {
			this.setupSwitchBotWebhook();
		}, 5000);

		this.homeyHash = this.homeyID;
		this.homeyHash = this.hashCode(this.homeyHash).toString();

		try
		{
			this.homeyIP = await this.homey.cloud.getLocalAddress();
		}
		catch (err)
		{
			// For cloud debugging only
			this.logLevel = 3;
			this.homey.settings.set('logLevel', this.logLevel);
			this.homeyIP = null;
		}

		// Callback for app settings changed
		this.homey.settings.on('set', async function settingChanged(setting)
		{
			this.homey.app.updateLog(`Setting ${setting} has changed.`, 3);
			if (setting === 'logLevel')
			{
				this.logLevel = this.homey.settings.get('logLevel');
				if (this.logLevel > 2)
				{
					this.homey.app.enableOAuth2Debug();
				}
				else
				{
					this.homey.app.disableOAuth2Debug();
				}
			}
			else if (setting === 'openToken')
			{
				this.openToken = this.homey.settings.get('openToken');
			}
			else if (setting === 'openSecret')
			{
				this.openSecret = this.homey.settings.get('openSecret');
			}
			else if (setting === 'numConnections')
			{
				this.numConnections = this.homey.settings.get('numConnections');
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

		const humidifierModeAction = this.homey.flow.getActionCard('set_humidifier_mode');
		humidifierModeAction
			.registerRunListener(async (args, state) =>
			{
				args.device.setCapabilityValue('measure_humidity', parseInt(args.humidity, 10));
				args.device.setCapabilityValue('humidifier_mode', args.mode);
				const valueObj = {
					humidifier_mode: parseInt(args.mode, 10),
					target_humidity: parseInt(args.humidity, 10),
				}
				return args.device.onCapabilityMode(valueObj);
			});

		const airPurifierModeAction = this.homey.flow.getActionCard('set_air_purifier_mode');
		airPurifierModeAction
			.registerRunListener(async (args, state) =>
			{
				args.device.setCapabilityValue('fan_level', args.fan_level.toString()).catch(this.error);
				args.device.setCapabilityValue('air_purifier_mode', args.mode.toString()).catch(this.error);
				return args.device.onCapabilityMode({ air_purifier_mode: args.mode, fan_level: args.fan_level });
			});

		const windowCoversAction = this.homey.flow.getActionCard('windowcoverings_custom_set');
		windowCoversAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityPosition(args.percentage, args.speed);
			});

		const vaccumStartAction = this.homey.flow.getActionCard('set_vaccum_start');
		vaccumStartAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.startVacuum(args.action, parseInt(args.fanPower, 10), parseInt(args.waterLevel, 10), parseInt(args.times, 10));
			});

		const lockAction = this.homey.flow.getActionCard('lock');
		lockAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityLock();
			});

		const unlockAction = this.homey.flow.getActionCard('unlock');
		unlockAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityUnlock();
			});

		const deadboltAction = this.homey.flow.getActionCard('deadbolt');
		deadboltAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityDeadbolt();
			});

		const relay1OnAction = this.homey.flow.getActionCard('onoff_relay1_true');
		relay1OnAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityOnOff('1', true)
			});

		const relay1OffAction = this.homey.flow.getActionCard('onoff_relay1_false');
		relay1OffAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityOnOff('1', false)
			});

		const relay2OnAction = this.homey.flow.getActionCard('onoff_relay2_true');
		relay2OnAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityOnOff('2', true)
			});

		const relay2OffAction = this.homey.flow.getActionCard('onoff_relay2_false');
		relay2OffAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityOnOff('2', false);
			});

		const radiatorThermostatModeAction = this.homey.flow.getActionCard('set_radiator_thermostat_mode');
		radiatorThermostatModeAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityRadiatorThermostatMode(args.mode);
			});

		const openCloseOnAction = this.homey.flow.getActionCard('open_close_true');
		openCloseOnAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityOpenClose(true)
			});

		const openCloseOffAction = this.homey.flow.getActionCard('open_close_false');
		openCloseOffAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityOpenClose(false)
			});

		/** * CONDITIONS ** */
		this.conditionVaccumStateIs = this.homey.flow.getConditionCard('vaccum_state_is');
		this.conditionVaccumStateIs.registerRunListener((args) =>
		{
			const { device, state } = args;
			const conditionMet = (device.getCapabilityValue('robot_vaccum_state') === state);
			return Promise.resolve(conditionMet);
		});

		// Device Triggers
		this.stateChangedTrigger = this.homey.flow.getDeviceTriggerCard('vaccum_state_changed');
		this.stateChangedToTrigger = this.homey.flow.getDeviceTriggerCard('vaccum_state_changed_to');
		this.stateChangedToTrigger.registerRunListener(async (args, state) =>
		{
			if (args.state === state.state)
			{
				return true;
			}
			return false;
		});

		this.taskChangedTrigger = this.homey.flow.getDeviceTriggerCard('vaccum_task_changed');
		this.taskChangedToTrigger = this.homey.flow.getDeviceTriggerCard('vaccum_task_changed_to');
		this.taskChangedToTrigger.registerRunListener(async (args, state) =>
		{
			if (args.state === state.state)
			{
				return true;
			}
			return false;
		});

		this.positionLessThanTrigger = this.homey.flow.getDeviceTriggerCard('position_became_less');
		this.positionLessThanTrigger.registerRunListener(async (args, state) =>
		{
			if ((args.position_threshold > state.position) && (args.position_threshold <= state.lastPosition))
			{
				return true;
			}
			return false;
		});

		this.positionGreaterThanTrigger = this.homey.flow.getDeviceTriggerCard('position_became_greater');
		this.positionGreaterThanTrigger.registerRunListener(async (args, state) =>
		{
			if ((args.position_threshold < state.position) && (args.position_threshold >= state.lastPosition))
			{
				return true;
			}
			return false;
		});

		this.homey.app.updateLog('****** App has initialised. ******');
	}

	async triggerPositionLessThan(device, tokens, state)
	{
		this.positionLessThanTrigger.trigger(device, tokens, state).catch(this.error);
	}

	async triggerPositionGreaterThan(device, tokens, state)
	{
		this.positionGreaterThanTrigger.trigger(device, tokens, state).catch(this.error);
	}

	async onUninit()
	{
		this.restoreLoggingMethods();
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
		try
		{
			this.logLevel = this.homey.settings.get('logLevel');
			if (errorLevel <= this.logLevel)
			{
				const nowTime = new Date(Date.now());

				this.diagLog += '\r\n* ';
				this.diagLog += nowTime.toJSON();
				this.diagLog += '\r\n';

				if (errorLevel === 0)
				{
					// this.error(newMessage);
					this.diagLog += '!!!!!! ';
				}
				else
				{
					// this.log(newMessage);
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
		catch (err)
		{
			this.originalError(`UpdateLog Error: ${newMessage}`);
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
			if (!this.webRegTimerID)
			{
				// Make sure the timer is started again to re-register all devices
				this.webRegTimerID = this.homey.setTimeout(() => this.doWebhookReg(), 2000);
			}

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
					this.updateLog(`Homey Webhook message error: ${err.message}`, 0);

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
			const nextInterval = (MINIMUM_POLL_INTERVAL * this.numConnections * 1000 * totalHuBDevices);

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
		if (!this.bleBusy && !this.bleDiscovery)
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
