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
const SECONDS_PER_DAY = 86400;
const DAILY_API_QUOTA = 10000;
const COMMAND_API_OVERHEAD = 500;
const POLLING_DAILY_BUDGET = DAILY_API_QUOTA - COMMAND_API_OVERHEAD;
const BLE_POLLING_INTERVAL = 30000; // in milliSeconds
class MyApp extends OAuth2App
{

	toPositiveInteger(value, fallback = 1)
	{
		const parsedValue = Number.parseInt(value, 10);
		if (!Number.isFinite(parsedValue) || (parsedValue < 1))
		{
			return fallback;
		}

		return parsedValue;
	}

	incrementApiCalls(increment = 1)
	{
		const value = Number.parseInt(increment, 10);
		const step = Number.isFinite(value) && (value > 0) ? value : 1;
		this.apiCalls = this.toPositiveInteger(this.apiCalls, 0) + step;
		this.homey.settings.set('apiCalls', this.apiCalls);
		return this.apiCalls;
	}

	formatRateLimitErrorMessage(message)
	{
		const rawMessage = message ? String(message) : 'Unknown error';
		const isRateLimitError = /rate\s*limit|too\s*many\s*requests|\b429\b|\b190\b/i.test(rawMessage);
		if (!isRateLimitError || /API calls/i.test(rawMessage))
		{
			return rawMessage;
		}

		return `${rawMessage} (${this.apiCalls} API calls)`;
	}

	formatMacAddress(value)
	{
		if (!value)
		{
			return value;
		}

		const macText = String(value);
		if (macText.includes(':'))
		{
			return macText;
		}

		const hexText = macText.replace(/[^a-fA-F0-9]/g, '');
		if (hexText.length !== 12)
		{
			return macText;
		}

		return hexText.match(/.{1,2}/g).join(':').toUpperCase();
	}

	normalizeLogMessage(newMessage)
	{
		const message = this.redactSensitiveLogData((typeof newMessage === 'string') ? newMessage : this.varToString(newMessage));
		const peripheralFormatted = message.replace(/(Peripheral Not Found:\s*)([a-fA-F0-9]{12})(\b)/g, (fullText, prefix, id, suffix) => `${prefix}${this.formatMacAddress(id)}${suffix}`);
		return peripheralFormatted.replace(/(No data for\s*)([a-fA-F0-9]{12})(\b)/gi, (fullText, prefix, id, suffix) => `${prefix}${this.formatMacAddress(id)}${suffix}`);
	}

	redactSensitiveLogData(message)
	{
		if (typeof message !== 'string' || message.length === 0)
		{
			return message;
		}

		let sanitized = message;

		// Redact known query/body secret patterns.
		sanitized = sanitized
			.replace(/([?&]client_id=)[^&\s]+/gi, '$1***')
			.replace(/([?&]client_secret=)[^&\s]+/gi, '$1***')
			.replace(/([?&]code=)[^&\s]+/gi, '$1***')
			.replace(/([?&]token=)[^&\s]+/gi, '$1***')
			.replace(/(Authorization\s*:\s*Bearer\s+)[^\s]+/gi, '$1***')
			.replace(/(\"Authorization\"\s*:\s*\"Bearer\s+)[^\"]+(\")/gi, '$1***$2');

		// Redact env.json values if they accidentally appear in logs.
		const env = Homey && Homey.env ? Homey.env : {};
		const envKeysToRedact = [
			'CLIENT_ID',
			'CLIENT_SECRET',
			'MAIL_HOST',
			'MAIL_USER',
			'MAIL_SECRET',
			'MAIL_RECIPIENT',
			'WEBHOOK_ID',
			'WEBHOOK_SECRET',
			'WEBHOOK_URL',
			'USER_AGENT_HEADER',
		];

		for (const key of envKeysToRedact)
		{
			const value = env[key];
			if (typeof value === 'string' && value.length > 0)
			{
				sanitized = sanitized.split(value).join('***');
			}
		}

		return sanitized;
	}

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
		const logMessage = optionalParams
			.map((param) => this.varToString(param))
			.join(' ');
		// if the logMessage contains 'User-Agent' then replace the user-agent value with '***'
		if (logMessage.includes('User-Agent:'))
		{
			const logMessageArray = logMessage.split(' ');
			const userAgentIndex = logMessageArray.findIndex((element) => element === 'User-Agent:');
			if (userAgentIndex !== -1)
			{
				logMessageArray[userAgentIndex + 2] = '***';
			}
			this.updateLog(logMessageArray.join(' '), 2, 'hub');
			return true;
		}

		this.updateLog(this.varToString(logMessage), 2, 'hub');
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
		this.homeyWebhookRegTimerID = null;
		this.switchBotWebhookTimerID = null;

		if (this.logLevel >= 0)
		{
			this.enableOAuth2Debug();
		}
		else
		{
			this.disableOAuth2Debug();
		}

		this.processWebhookMessage.bind(this);

		this.numConnections = this.toPositiveInteger(this.homey.settings.get('numConnections'));
		if (!this.homey.settings.get('numConnections'))
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

		try
		{
			this.homeyID = await this.homey.cloud.getHomeyId();
		}
		catch (err)
		{
			this.homeyID = 'unknown-homey';
			this.updateLog(`Failed to get Homey ID at startup: ${err.message}`, 0, 'hub');
		}

		// Setup the SwitchBot webhook after a short delay to allow devices to register
		this.switchBotWebhookTimerID = this.homey.setTimeout(() =>
		{
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
			this.logLevel = 0;
			this.homey.settings.set('logLevel', this.logLevel);
			this.homeyIP = null;
		}

		// Callback for app settings changed
		this.homey.settings.on('set', async (setting) =>
		{
			this.homey.app.updateLog(`Setting ${setting} has changed.`, 3, 'hub');
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
				this.numConnections = this.toPositiveInteger(this.homey.settings.get('numConnections'));
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

		// Webhook registration backoff tracking
		this.webhookRetryCount = 0;

		// Track in-progress OAuth flows started from settings
		this.settingsOAuthFlows = {};

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
			if (state && (args.state === state.state))
			{
				return true;
			}
			return false;
		});

		this.taskChangedTrigger = this.homey.flow.getDeviceTriggerCard('vaccum_task_changed');
		this.taskChangedToTrigger = this.homey.flow.getDeviceTriggerCard('vaccum_task_changed_to');
		this.taskChangedToTrigger.registerRunListener(async (args, state) =>
		{
			if (state && (args.state === state.state))
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

		this.homey.app.updateLog('****** App has initialised. ******', 'hub');
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
		if (this.apiCountReset)
		{
			this.homey.clearTimeout(this.apiCountReset);
			this.apiCountReset = null;
		}
		if (this.homeyWebhookRegTimerID)
		{
			this.homey.clearTimeout(this.homeyWebhookRegTimerID);
			this.homeyWebhookRegTimerID = null;
		}
		if (this.switchBotWebhookTimerID)
		{
			this.homey.clearTimeout(this.switchBotWebhookTimerID);
			this.switchBotWebhookTimerID = null;
		}
		if (this.timerHubID)
		{
			this.homey.clearTimeout(this.timerHubID);
			this.timerHubID = null;
		}
		if (this.bleTimerID)
		{
			this.homey.clearTimeout(this.bleTimerID);
			this.bleTimerID = null;
		}
		this.restoreLoggingMethods();
		await this.deleteSwitchBotWebhook();
	}

	resetAPICount()
	{
		this.apiCalls = 0;

		// Set timer to reset the count at midnight
		this.apiCountReset = this.homey.setTimeout(this.resetAPICount, 86400 * 1000);
	}

	getAPICount()
	{
		return this.apiCalls;
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
				const stack = source.stack ? source.stack.replace(/\n/g, '\n') : '';
				return `${source.message}\n${stack}`;
			}
			if (typeof source === 'object')
			{
				const getCircularReplacer = () =>
				{
					const seen = new WeakSet();
					return (key, value) =>
					{
						if (typeof key === 'string' && key.startsWith('_'))
						{
							return '...';
						}

						if (typeof value === 'object' && value !== null)
						{
							if (seen.has(value))
							{
								return '[Circular]';
							}
							seen.add(value);
						}
						return value;
					};
				};

				return JSON.stringify(source, getCircularReplacer(), 2);
			}
			if (typeof source === 'string')
			{
				return source;
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`VarToString Error: ${err}`, 0, 'hub');
		}

		return source.toString();
	}

	updateLog(newMessage, errorLevel = 2, logSource = 'hub')
	{
		try
		{
			const message = this.normalizeLogMessage(newMessage);
			this.logLevel = this.homey.settings.get('logLevel');
			const logFilter = this.homey.settings.get('logSource') || 'all';
			if (errorLevel === 0 || (errorLevel <= this.logLevel && (logFilter === 'all' || logFilter === logSource)))
			{
				this.originalLog(message);
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
				this.diagLog += message;
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
						this.updateLog(`sendLog: fetching device status for ${deviceId}`, 1, 'hub');
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
				this.updateLog(`Send log error: ${err.message}`, 0, 'hub');
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
				if (response.statusCode && response.statusCode !== 100)
				{
					this.homey.app.updateLog(`Invalid response code: ${response.statusCode}\nMessage: ${response.message}`, 'hub');
					throw (new Error(`Invalid response code: ${response.statusCode} ${response.message}`));
				}

				return response.body ? response.body : response;
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
			this.updateLog('Deleting SwitchBot webhook', 1, 'hub');
			await oAuth2Client.deleteWebhook(Homey.env.WEBHOOK_URL);
		}
	}

	async processWebhookMessage(message)
	{
		this.updateLog(`Got a webhook message! ${this.varToString(message)}`, 1, 'hub');
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
						this.updateLog(`Error processing webhook message! ${err.message}`, 0, 'hub');
					}
				}
			}
		}
	}

	async registerHomeyWebhook(DeviceMAC)
	{
		// See if the SwitchBot device is already in the list of devices we are registering the webhook for.
		if (this.devicesMACs.findIndex((device) => device.localeCompare(DeviceMAC, 'en', { sensitivity: 'base' }) === 0) >= 0)
		{
			// Device is already in the list so no need to register it again
			return;
		}

		// Clear the existing timer to delay the webhook registration if it exists so we can start a new one with the updated list of devices
		if (this.homeyWebhookRegTimerID)
		{
			this.homey.clearTimeout(this.homeyWebhookRegTimerID);
		}

		// Add the new device to the list of devices we want to register the webhook for
		this.devicesMACs.push(DeviceMAC);

		// Delay the actual registration to allow other devices to initialise and do them all at once
		this.webhookRetryCount = 0;
		this.homeyWebhookRegTimerID = this.homey.setTimeout(() => this.doWebhookReg(), 2000);
	}

	async doWebhookReg()
	{
		this.homeyWebhookRegTimerID = null;
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
				this.updateLog(`Homey Webhook failed to unregister, Error: ${err.message}`, 0, 'hub');

				// Try again later with exponential backoff
				if (!this.homeyWebhookRegTimerID)
				{
					this.webhookRetryCount++;
					const baseDelay = Math.min(5000 * Math.pow(2, Math.min(this.webhookRetryCount - 1, 3)), 60000);
					const jitter = Math.random() * 1000;
					const nextDelay = Math.floor(baseDelay + jitter);
					this.updateLog(`Homey Webhook will retry in ${nextDelay}ms (attempt ${this.webhookRetryCount})`, 1, 'hub');
					this.homeyWebhookRegTimerID = this.homey.setTimeout(() => this.doWebhookReg(), nextDelay);
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
					this.updateLog(`Homey Webhook message error: ${err.message}`, 0, 'hub');

					// Try again later
					if (!this.homeyWebhookRegTimerID)
					{
						this.webhookRetryCount++;
						const baseDelay = Math.min(5000 * Math.pow(2, Math.min(this.webhookRetryCount - 1, 3)), 60000);
						const jitter = Math.random() * 1000;
						const nextDelay = Math.floor(baseDelay + jitter);
						this.homeyWebhookRegTimerID = this.homey.setTimeout(() => this.doWebhookReg(), nextDelay);
					}
				}
			});

			this.updateLog(`Homey Webhook registered for devices ${this.homey.app.varToString(data)}`, 1, 'hub');
			this.webhookRetryCount = 0;
		}
		catch (err)
		{
			this.updateLog(`Homey Webhook registration failed for devices ${this.homey.app.varToString(data)}, Error: ${err.message}`, 0, 'hub');

			// Exponential backoff with jitter and cap
			if (!this.homeyWebhookRegTimerID)
			{
				this.webhookRetryCount++;
				const baseDelay = Math.min(5000 * Math.pow(2, Math.min(this.webhookRetryCount - 1, 3)), 60000);
				const jitter = Math.random() * 1000;
				const nextDelay = Math.floor(baseDelay + jitter);
				this.updateLog(`Homey Webhook will retry in ${nextDelay}ms (attempt ${this.webhookRetryCount})`, 1, 'hub');
				this.homeyWebhookRegTimerID = this.homey.setTimeout(() => this.doWebhookReg(), nextDelay);
			}
		}
	}

	async ensureSwitchBotWebhook()
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
					if (!response1.statusCode || response1.statusCode === 100)
					{
						// We got a valid response so make sure it is the correct webhook
						const body = response1.body ? response1.body : response1;
						if (body.urls && Array.isArray(body.urls) && body.urls.length > 0)
						{
							if (body.urls[0].localeCompare(Homey.env.WEBHOOK_URL, 'en', { sensitivity: 'base' }) === 0)
							{
								this.homey.app.updateLog('SwitchBot webhook already registered', 1, 'hub');
								return true;
							}

							// Delete the current web hook so we can replace it with ours
							const response2 = await oAuth2Client.deleteWebhook(body.urls[0]);
							if (response2)
							{
								if (response2.statusCode && response2.statusCode !== 100)
								{
									this.homey.app.updateLog(`Delete webhook failed\nInvalid response code: ${response2.statusCode}\nMessage: ${response2.message}`, 0, 'hub');
									return false;
								}

								this.homey.app.updateLog('Deleted old webhook', 3, 'hub');
							}
						}
						else
						{
							this.homey.app.updateLog('No existing SwitchBot webhook found', 3, 'hub');
						}
					}
				}

				const response = await oAuth2Client.setWebhook(Homey.env.WEBHOOK_URL);
				if (response)
				{
					if (!response.statusCode || response.statusCode !== 100)
					{
						this.homey.app.updateLog(`Invalid response code: ${response.statusCode}\nMessage: ${response.message}`, 0, 'hub');
						return false;
					}
					this.homey.app.updateLog('Registered SwitchBot webhook', 1, 'hub');
					return true;
				}
				this.homey.app.updateLog('No response when registering the SwitchBot webhook', 0, 'hub');
				return false;
			}

			this.homey.app.updateLog('No OAuth client available to register the SwitchBot webhook', 0, 'hub');
		}
		catch (err)
		{
			const errorMessage = this.formatRateLimitErrorMessage(err && err.message ? err.message : err);
			this.homey.app.updateLog(`Invalid response: ${errorMessage}`, 0, 'hub');
		}

		return false;
	}

	async setupSwitchBotWebhook()
	{
		const isStartupAttempt = !this.switchBotWebhookTimerID;

		// Setup a timer to ensure the webhook is registered every hour in case of issues with the SwitchBot cloud or the Homey webhook service
		if (this.switchBotWebhookTimerID)
		{
			this.homey.clearTimeout(this.switchBotWebhookTimerID);
		}

		// Timer to check if the webhook is registered every hour. If not, try to register it again. If there are issues with the SwitchBot cloud or the Homey webhook service, try again every minute.
		const startedAt = Date.now();
		let timer = 60 * 60 * 1000;
		const isRegistered = await this.ensureSwitchBotWebhook();
		if (!isRegistered)
		{
			timer = 60 * 1000;
		}

		if (isStartupAttempt)
		{
			const elapsedMs = Date.now() - startedAt;
			if (isRegistered)
			{
				this.updateLog(`Startup webhook ensure succeeded in ${elapsedMs}ms; next check in ${Math.floor(timer / 60000)}m`, 1, 'hub');
			}
			else
			{
				this.updateLog(`Startup webhook ensure failed in ${elapsedMs}ms; next retry in ${Math.floor(timer / 1000)}s`, 0, 'hub');
			}
		}

		// setup to call this function again after the timer expires to ensure the webhook is always registered
		this.switchBotWebhookTimerID = this.homey.setTimeout(() => this.setupSwitchBotWebhook(), timer);
	}

	/**
	 * Helper method to get the first saved OAuth2 client.
	 * getSavedOAuth2Sessions() returns an object of { sessionId: sessionData },
	 * but the code often needs to work with a single client instance.
	 * This safely retrieves the first one, or returns null if none exist.
	 * @returns {OAuth2Client|null}
	 */
	getFirstSavedOAuth2Client()
	{
		try
		{
			const savedSessions = this.getSavedOAuth2Sessions();
			if (savedSessions && Object.keys(savedSessions).length > 0)
			{
				// Get the first session ID and retrieve its client
				const firstSessionId = Object.keys(savedSessions)[0];
				return this.getOAuth2Client({
					configId: 'default',
					sessionId: firstSessionId,
				});
			}
			return null;
		}
		catch (err)
		{
			this.updateLog(`Error getting first OAuth2 client: ${err.message}`, 0, 'hub');
			return null;
		}
	}

	async getHUBDevices()
	{
		let response = null;
		if (this.homey.app.openToken)
		{
			response = await this.hub.getDevices();
			if (response.statusCode && response.statusCode !== 100)
			{
				this.homey.app.updateLog(`Invalid response code: ${response.statusCode}\nMessage: ${response.message}`, 0, 'hub');
				throw (new Error(`Invalid response code: ${response.statusCode} ${response.message}`));
			}
		}
		else
		{
			// Find an OAuth session
			try
			{
				const oAuth2Client = this.getFirstSavedOAuth2Client();
				if (oAuth2Client)
				{
					response = await oAuth2Client.getDevices();
					if (response)
					{
						if (response.statusCode && response.statusCode !== 100)
						{
							this.homey.app.updateLog(`Invalid response code: ${response.statusCode}\nMessage: ${response.message}`, 0, 'hub');
							throw (new Error(`Invalid response code: ${response.statusCode} ${response.message}`));
						}

						const devices = response.body ? response.body : response;

						if (devices && devices.deviceList)
						{
							const scenes = await oAuth2Client.getScenes();
							if (scenes)
							{
								devices.sceneList = scenes.body ? scenes.body : scenes;
							}
							return devices;
						}

						throw (new Error(`No devices found: ${this.varToString(response)}`));
					}
				}
			}
			catch (err)
			{
				this.homey.app.updateLog(`getHUBDevices OAuth2 error: ${err.message}`, 0, 'hub');
			}

			return response;
		}
	}

	async runScene(id)
	{
		const oAuth2Client = this.getFirstSavedOAuth2Client();
		if (oAuth2Client)
		{
			const retData = await oAuth2Client.startScene(id);
			return retData.body ? retData.body : retData;
		}

		return this.hub.startScene(id);
	}

	async startSettingsOAuthLogin()
	{
		try
		{
			const flowId = `settings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const sessionId = `settings-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

			const client = this.createOAuth2Client({
				sessionId,
				configId: 'default',
			});

			const authorizationUrl = client.getAuthorizationUrl();
			this.updateLog('OAuth authorization URL prepared', 0, 'hub');

			const callback = await this.homey.cloud.createOAuth2Callback(authorizationUrl);
			this.updateLog(`OAuth callback created`, 0, 'hub');

			this.settingsOAuthFlows[flowId] = {
				sessionId,
				status: 'pending',
				startedAt: Date.now(),
			};

			// Set up the 'url' event listener first (before Promise)
			let urlPromise;
			const urlPromiseObj = new Promise((resolve) => {
				callback.on('url', (url) => {
					this.updateLog('OAuth callback URL received', 0, 'hub');
					resolve(url);
				});
			});
			urlPromise = urlPromiseObj;

			// Set up the 'code' event listener (async handling, non-blocking)
			callback.on('code', async (code) => {
				try
				{
					this.updateLog(`OAuth code received: ${code.substring(0, 30)}...`, 0, 'hub');
					this.updateLog(`About to call getTokenByCode with client redirectUrl property: ${client._redirectUrl || 'UNDEFINED'}`, 0, 'hub');
					await client.getTokenByCode({ code });

					// Get session information for display
					const session = await client.onGetOAuth2SessionInformation();
					const token = client.getToken();
					const { title } = session;

					// Set the title and token on the client
					client.setTitle({ title });
					client.setToken({ token });

					// Save the client to persist the OAuth session
					client.save();

					this.settingsOAuthFlows[flowId] = {
						...this.settingsOAuthFlows[flowId],
						status: 'authorized',
					};

					this.updateLog(`Settings OAuth login successful for user: ${title}`, 2, 'hub');
				}
				catch (err)
				{
					this.settingsOAuthFlows[flowId] = {
						...this.settingsOAuthFlows[flowId],
						status: 'failed',
						error: err.message,
					};
					this.updateLog(`Settings OAuth code exchange failed: ${err.message}`, 0, 'hub');
				}
			});

			// Wait for the URL with timeout
			const authUrl = await Promise.race([
				urlPromise,
				new Promise((_, reject) =>
					this.homey.setTimeout(() => reject(new Error('Timed out while preparing OAuth callback URL')), 15000)
				),
			]);

			return {
				flowId,
				authUrl,
			};
		}
		catch (err)
		{
			this.updateLog(`startSettingsOAuthLogin error: ${err.message}`, 0, 'hub');
			throw err;
		}
	}

	async getScenes()
	{
		// Find an OAuth session
		const oAuth2Client = this.getFirstSavedOAuth2Client();
		if (oAuth2Client)
		{
			const response = await oAuth2Client.getScenes();
			if (response.statusCode && response.statusCode !== 100)
			{
				this.homey.app.updateLog(`Invalid response code: ${response.statusCode}`, 0, 'hub');
				throw (new Error(`Invalid response code: ${response.statusCode}`));
			}

			const searchData = response.body ? response.body : response;
			const scenes = [];

			if (Array.isArray(searchData))
			{
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
		this.hubDevices = Math.max(0, this.hubDevices - 1);
		if ((this.hubDevices === 0) && (this.timerHubID !== null))
		{
			this.homey.clearTimeout(this.timerHubID);
			this.timerHubID = null;
		}
	}

	async onHubPoll()
	{
		this.homey.app.updateLog(`Polling hub: ${this.homey.app.apiCalls} API calls today`, 'hub');
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
					try
					{
						if (await device.pollHubDeviceValues())
						{
							totalHuBDevices++;
						}
					}
					catch (err)
					{
						const deviceName = (device.getName && typeof device.getName === 'function') ? device.getName() : 'Unknown device';
						const deviceData = (device.getData && typeof device.getData === 'function') ? device.getData() : {};
						this.homey.app.updateLog(`Hub poll failed for ${deviceName} (${deviceData.id || 'unknown id'}): ${err.message}`, 0, 'hub');
					}
				}
			}
		}

		if (totalHuBDevices > 0)
		{
			const minimumIntervalMs = MINIMUM_POLL_INTERVAL * 1000;
			const quotaIntervalMs = Math.ceil((SECONDS_PER_DAY * 1000 * totalHuBDevices * this.numConnections) / POLLING_DAILY_BUDGET);
			const nextInterval = Math.max(minimumIntervalMs, quotaIntervalMs);

			this.homey.app.updateLog(`Next HUB polling interval = ${nextInterval / 1000}s for ${totalHuBDevices} active devices across ${this.numConnections} Homey account connection(s): ${this.homey.app.apiCalls} API calls today`, 'hub');
			this.timerHubID = this.homey.setTimeout(this.onHubPoll, nextInterval);
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
		this.bleDevices = Math.max(0, this.bleDevices - 1);
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
			this.updateLog('\r\n------ Polling BLE Starting ------', 'hub');

			const promises = [];
			try
			{
				// Run discovery too fetch new data
				await this.homey.ble.discover(['cba20d00224d11e69fb80002a5d5c51b'], 2000);
				this.updateLog('BLE Finished Discovery', 'hub');

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

				this.updateLog('Polling BLE: waiting for devices to update', 'hub');
				await Promise.all(promises);
			}
			catch (err)
			{
				this.updateLog(`BLE Polling Error: ${err.message}`, 'hub');
			}

			this.blePolling = false;
			this.bleBusy = false;
			this.updateLog('------ Polling BLE Finished ------\r\n', 'hub');
		}
		else
		{
			this.updateLog('Polling BLE skipped while discovery in progress\r\n', 'hub');
		}

		if (this.bleDevices > 0)
		{
			this.updateLog(`Next BLE polling interval = ${BLE_POLLING_INTERVAL}`, 'hub');
			this.bleTimerID = this.homey.setTimeout(this.onBLEPoll, BLE_POLLING_INTERVAL);
		}
		else
		{
			this.bleTimerID = null;
			this.updateLog('BLE polling stopped: no registered BLE devices', 'hub');
		}
	}

}

module.exports = MyApp;
