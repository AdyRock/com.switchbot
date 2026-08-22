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
const BLE_ADVERTISEMENT_RATE_LIMIT_MS = 5000;
const BLE_ADVERTISEMENT_STALE_POLL_MS = 120000;
const HUB_POLL_MISSING_AUTH_INTERVAL_MS = 60000;
const WEBHOOK_AUTH_MISSING_INTERVAL_MS = 5 * 60 * 1000;
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

	installProcessErrorGuards()
	{
		if (this.processErrorGuardsInstalled)
		{
			return;
		}

		this.processErrorGuardsInstalled = true;

		process.on('unhandledRejection', (reason) =>
		{
			const message = this.varToString(reason);
			try
			{
				this.updateLog(`Unhandled rejection captured: ${message}`, 0, 'hub');
			}
			catch (err)
			{
				if (this.originalError)
				{
					this.originalError(`Unhandled rejection captured: ${message}`);
				}
			}
		});

		process.on('uncaughtException', (error) =>
		{
			const message = this.varToString(error);
			try
			{
				this.updateLog(`Uncaught exception captured: ${message}`, 0, 'hub');
			}
			catch (err)
			{
				if (this.originalError)
				{
					this.originalError(`Uncaught exception captured: ${message}`);
				}
			}
		});
	}

	safeSetSetting(key, value)
	{
		try
		{
			const result = this.homey.settings.set(key, value);
			if (result && typeof result.catch === 'function')
			{
				result.catch((err) =>
				{
					this.updateLog(`Failed to persist setting "${key}": ${err.message}`, 0, 'hub');
				});
			}
		}
		catch (err)
		{
			this.updateLog(`Failed to persist setting "${key}": ${err.message}`, 0, 'hub');
		}
	}

	persistApiCalls(immediate = false)
	{
		if (immediate)
		{
			if (this.apiCallsPersistTimer)
			{
				this.homey.clearTimeout(this.apiCallsPersistTimer);
				this.apiCallsPersistTimer = null;
			}

			this.safeSetSetting('apiCalls', this.apiCalls);
			return;
		}

		if (this.apiCallsPersistTimer)
		{
			return;
		}

		this.apiCallsPersistTimer = this.homey.setTimeout(() =>
		{
			this.apiCallsPersistTimer = null;
			this.safeSetSetting('apiCalls', this.apiCalls);
		}, 5000);
	}

	incrementApiCalls(increment = 1)
	{
		const value = Number.parseInt(increment, 10);
		const step = Number.isFinite(value) && (value > 0) ? value : 1;
		this.apiCalls = this.toPositiveInteger(this.apiCalls, 0) + step;
		this.persistApiCalls();
		return this.apiCalls;
	}

	formatRateLimitErrorMessage(message)
	{
		const rawMessage = message ? String(message) : 'Unknown error';
		const isRateLimitError = /rate\s*limit|too\s*many\s*requests|\b429\b/i.test(rawMessage);
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

	getWebhookAuthMode()
	{
		const oAuth2Client = this.getFirstSavedOAuth2Client();
		if (oAuth2Client)
		{
			return 'OAuth2 session';
		}

		if (this.openToken && this.openSecret)
		{
			return 'API token/secret';
		}

		return 'unavailable (no OAuth session and no API token/secret)';
	}

	hasHubAuthAvailable()
	{
		if (this.openToken && this.openSecret)
		{
			return true;
		}

		return Boolean(this.getFirstSavedOAuth2Client());
	}

	hasWebhookEligibleDevices()
	{
		return Array.isArray(this.devicesMACs) && this.devicesMACs.length > 0;
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
			.replace(/("Authorization"\s*:\s*"Bearer\s+)[^"]+(")/gi, '$1***$2');

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

	/* eslint-disable no-console */
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
	/* eslint-enable no-console */

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
		'lock_ultra_hub',
		'lock_vision_pro_hub',
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
		'smart_fan_new_hub',
		'speaker',
		'strip_light',
		'temperature_hub',
		'tv_hub',
		'weather_station_hub',
		'water_leak_hub',
	];

	/**
	 * onInit is called when the app is initialized.
	 */
	async onOAuth2Init()
	{
		this.overrideLoggingMethods();
		this.installProcessErrorGuards();

		this.log('SwitchBot has been initialized');
		this.logLevel = this.homey.settings.get('logLevel');
		if (this.logLevel === null)
		{
			this.logLevel = 0;
			this.safeSetSetting('logLevel', this.logLevel);
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
		this.apiCallsPersistTimer = null;
		this.hubAuthMissingLogged = false;
		this.webhookAuthMissingLogged = false;
		this.cachedFirstOAuth2Client = null;
		this.cachedFirstOAuth2SessionId = null;

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
			this.safeSetSetting('numConnections', this.numConnections);
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
			this.safeSetSetting('debugMode', true);
		}
		else
		{
			this.safeSetSetting('debugMode', false);
		}

		this.hub = new HubInterface(this.homey);

		try
		{
			this.homeyID = await this.homey.cloud.getHomeyId();
		}
		catch (err)
		{
			this.homeyID = 'unknown-homey';
			this.updateLog(`Failed to get Homey ID at startup: ${err.message}`, 0, 'all');
		}

		// Webhook setup starts when a hub/cloud device registers for webhook updates.
		this.updateLog('SwitchBot webhook setup deferred until a hub/cloud device is registered', 1, 'all');

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
			this.safeSetSetting('logLevel', this.logLevel);
			this.homeyIP = null;
		}

		// Callback for app settings changed
		this.homey.settings.on('set', async (setting) =>
		{
			try
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
			}
			catch (err)
			{
				this.updateLog(`settings.on('set') handler error (${setting}): ${err.message}`, 0, 'hub');
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
		const hasHomeyFeatureApi = this.homey && (typeof this.homey.hasFeature === 'function');
		this.bleAdvertisementSupported = hasHomeyFeatureApi ? this.homey.hasFeature('ble-advertisements') : false;
		this.bleAdvertisementSubscriptions = new Map();
		this.bleAdvertisementSubscriptionPending = new Map();
		this.bleAdvertisementDeviceState = new Map();
		this.bleAdvertisementDeviceKeys = new WeakMap();
		this.bleAdvertisementDeviceRegistry = new Map();
		// Lookup used by webhook dispatch; keys are normalized device ids/addresses.
		this.webhookDeviceRegistry = new Map();
		this.bleAdvertisementNextKey = 1;
		this.blePollingFallbackDevices = new Set();
		this.bleRegisteredDevices = new Set();
		this.bleDiscoverUnavailableLogged = false;
		if (!hasHomeyFeatureApi)
		{
			this.updateLog('Homey runtime has no hasFeature API, using polling fallback', 1, 'ble');
		}
		if (this.bleAdvertisementSupported)
		{
			this.updateLog('BLE advertisement subscriptions enabled', 1, 'ble');
		}
		else
		{
			this.updateLog('BLE advertisement subscriptions unavailable on this Homey, using polling fallback', 1, 'ble');
		}

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

		const circulatingFanAction = this.homey.flow.getActionCard('circulating_fan_mode');
		circulatingFanAction.registerRunListener(async (args, state) =>
		{
			args.device.setCapabilityValue('smart_fan_mode2', args.fan_mode).catch(this.error);
			return args.device.onCapabilityFanMode(args.fan_mode);
		});

		const setNightLightAction = this.homey.flow.getActionCard('set_night_light');
		setNightLightAction.registerRunListener(async (args, state) =>
		{
			args.device.setCapabilityValue('night_light', args.night_light).catch(this.error);
			return args.device.onCapabilityNightLight(args.night_light);
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

		const customQuoteAction = this.homey.flow.getActionCard('customQuote');
		customQuoteAction.registerRunListener(async (args, state) =>
		{
			if (typeof args.device.onCapabilityCustomQuote === 'function')
			{
				return args.device.onCapabilityCustomQuote(args.custom_text);
			}

			return args.device._operateDevice('customQuote', args.custom_text);
		});

		const cancelCustomAction = this.homey.flow.getActionCard('cancelCustom');
		cancelCustomAction.registerRunListener(async (args, state) =>
		{
			if (typeof args.device.onCapabilityCancelCustom === 'function')
			{
				return args.device.onCapabilityCancelCustom();
			}

			return args.device._operateDevice('cancelCustom', 'default');
		});

		const customPageAction = this.homey.flow.getActionCard('customPage');
		customPageAction.registerRunListener(async (args, state) =>
		{
			if (typeof args.device.onCapabilityCustomPage === 'function')
			{
				return args.device.onCapabilityCustomPage(args.custom_text);
			}

			return args.device._operateDevice('customPage', args.custom_text);
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
				};
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
				return args.device.onCapabilityOnOff('1', true);
			});

		const relay1OffAction = this.homey.flow.getActionCard('onoff_relay1_false');
		relay1OffAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityOnOff('1', false);
			});

		const relay2OnAction = this.homey.flow.getActionCard('onoff_relay2_true');
		relay2OnAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityOnOff('2', true);
			});

		const relay2OffAction = this.homey.flow.getActionCard('onoff_relay2_false');
		relay2OffAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityOnOff('2', false);
			});

		const colourOnAction = this.homey.flow.getActionCard('onoff_colour_true');
		colourOnAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityColorOnOff(true);
			});

		const colourOffAction = this.homey.flow.getActionCard('onoff_colour_false');
		colourOffAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityColorOnOff(false);
			});

		const dimColourAction = this.homey.flow.getActionCard('set_dim_colour');
		dimColourAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityColorDim(args.brightness);
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
				return args.device.onCapabilityOpenClose(true);
			});

		const openCloseOffAction = this.homey.flow.getActionCard('open_close_false');
		openCloseOffAction
			.registerRunListener(async (args, state) =>
			{
				return args.device.onCapabilityOpenClose(false);
			});

		/** * CONDITIONS ** */
		this.conditionVaccumStateIs = this.homey.flow.getConditionCard('vaccum_state_is');
		this.conditionVaccumStateIs.registerRunListener((args) =>
		{
			const { device, state } = args;
			const conditionMet = (device.getCapabilityValue('robot_vaccum_state') === state);
			return Promise.resolve(conditionMet);
		});

		this.conditionOnoffColourIsTrue = this.homey.flow.getConditionCard('onoff_colour_is_true');
		this.conditionOnoffColourIsTrue.registerRunListener((args) =>
		{
			const { device } = args;
			const conditionMet = (device.getCapabilityValue('onoff.colour') === true);
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

		this.vaccumCleaningStartedTrigger = this.homey.flow.getDeviceTriggerCard('vaccum_cleaning_started');
		this.vaccumCleaningStoppedTrigger = this.homey.flow.getDeviceTriggerCard('vaccum_cleaning_stopped');

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

		await this.unregisterAllBLEAdvertisementSubscriptions();
		this.persistApiCalls(true);
		this.restoreLoggingMethods();
		await this.deleteSwitchBotWebhook();
	}

	resetAPICount()
	{
		this.apiCalls = 0;
		this.persistApiCalls(true);

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

	getLogFilterDevices()
	{
		const filterDevices = [];
		const drivers = this.homey && this.homey.drivers ? this.homey.drivers.getDrivers() : {};
		for (const driver of Object.values(drivers))
		{
			const devices = driver && typeof driver.getDevices === 'function' ? driver.getDevices() : {};
			for (const device of Object.values(devices))
			{
				const data = device && typeof device.getData === 'function' ? device.getData() : {};
				const homeyName = device && typeof device.getName === 'function' ? device.getName() : '';
				const driverId = String((device && device.driver && (device.driver.id || (device.driver.manifest && device.driver.manifest.id))) || '');
				const identifier = data && (data.address || data.id || data.pid) ? String(data.address || data.id || data.pid) : '';
				const switchBotName = String((data && (data.deviceName || data.name)) || homeyName || '');
				const deviceType = String((data && data.type) || driverId || '');

				filterDevices.push({
					identifier,
					switchBotName,
					homeyName: String(homeyName || ''),
					deviceType,
					driverId,
					aliases: [data && data.address, data && data.id, data && data.pid, data && data.type, data && data.deviceName, data && data.name, homeyName, driverId]
						.filter((value) => typeof value === 'string' && value.trim().length > 0)
						.map((value) => value.trim()),
				});
			}
		}

		return filterDevices;
	}

	getLogFilterOptions()
	{
		const devices = this.getLogFilterDevices();
		const optionFields = ['identifier', 'switchBotName', 'homeyName', 'deviceType'];
		const options = {};
		for (const field of optionFields)
		{
			options[field] = Array.from(new Set(devices.map((device) => device[field]).filter(Boolean)))
				.sort((left, right) => left.localeCompare(right));
		}

		return options;
	}

	matchesLogDeviceFilter(message)
	{
		const filterType = this.homey.settings.get('logFilterType') || 'none';
		const filterValue = String(this.homey.settings.get('logFilterValue') || '').trim();
		if (filterType === 'none' || !filterValue)
		{
			return true;
		}

		const matchingDevices = this.getLogFilterDevices()
			.filter((device) => device[filterType] === filterValue);
		if (matchingDevices.length === 0)
		{
			return false;
		}

		const normalizedMessage = String(message).toLowerCase();
		const compactMessage = normalizedMessage.replace(/[^a-z0-9]/g, '');
		return matchingDevices.some((device) => device.aliases.some((alias) => {
			const normalizedAlias = alias.toLowerCase();
			const compactAlias = normalizedAlias.replace(/[^a-z0-9]/g, '');
			return normalizedMessage.includes(normalizedAlias) || (compactAlias.length >= 6 && compactMessage.includes(compactAlias));
		}));
	}

	updateLog(newMessage, errorLevel = 2, logSource = 'hub')
	{
		try
		{
			const message = this.normalizeLogMessage(newMessage);
			this.logLevel = this.homey.settings.get('logLevel');
			const logFilter = this.homey.settings.get('logSource') || 'all';

			if (this.logLevel !== 1 && errorLevel === 1)
			{
				// Only log webhook messages if log level is 1
				return;
			}

			if (errorLevel === 0 || (errorLevel <= this.logLevel && (logFilter === 'all' || logFilter === logSource) && this.matchesLogDeviceFilter(message)))
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
					const realtimeResult = this.homey.api.realtime('com.switchbot.logupdated', { log: this.diagLog });
					if (realtimeResult && typeof realtimeResult.catch === 'function')
					{
						realtimeResult.catch((err) =>
						{
							this.originalError(`Realtime log update failed: ${err.message}`);
						});
					}
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
			return;
		}

		if (this.openToken && this.openSecret)
		{
			this.updateLog('Deleting SwitchBot webhook using API token', 1, 'hub');
			await this.hub.deleteWebhook(Homey.env.WEBHOOK_URL);
		}
	}

	getWebhookDispatchDevices(message)
	{
		if (!message)
		{
			return [];
		}

		const context = message.context || message;

		// Build a set of normalized lookup keys from the webhook message and context.
		const lookupKeys = new Set();
		for (const rawKey of [
			context && context.deviceMac,
			context && context.deviceId,
			message && message.deviceMac,
			message && message.deviceId,
		])
		{
			for (const key of this.getNormalizedLookupKeys(rawKey))
			{
				lookupKeys.add(key);
			}
		}

		const devices = [];
		for (const lookupKey of lookupKeys)
		{
			// Check the cached registry for a matching device registration.
			let registration = this.webhookDeviceRegistry.get(lookupKey);

			// If no valid registration is found, scan the loaded drivers for a matching device with a processWebhookMessage handler.
			if (!registration || !registration.device || (typeof registration.device.processWebhookMessage !== 'function'))
			{
				if (registration && registration.device && (typeof registration.device.processWebhookMessage !== 'function'))
				{
					const invalidName = registration.name || (registration.device.getName && typeof registration.device.getName === 'function' ? registration.device.getName() : 'Unknown webhook device');
					this.updateLog(`Ignoring webhook registry entry without handler for key ${lookupKey}: ${invalidName}`, 2, 'hub');
				}

				const drivers = this.homey && this.homey.drivers ? this.homey.drivers.getDrivers() : {};
				// Fallback path: recover from stale/missing registry entries by scanning loaded drivers.
				for (const driver of Object.values(drivers))
				{
					const driverDevices = driver && typeof driver.getDevices === 'function' ? driver.getDevices() : {};
					for (const device of Object.values(driverDevices))
					{
						if (!device || typeof device.getData !== 'function')
						{
							continue;
						}

						if (typeof device.processWebhookMessage !== 'function')
						{
							continue;
						}

						const deviceData = device.getData();
						const candidateIds = new Set();
						for (const candidateValue of [deviceData && (deviceData.id || deviceData.pid), deviceData && deviceData.address])
						{
							for (const key of this.getNormalizedLookupKeys(candidateValue))
							{
								candidateIds.add(key);
							}
						}
						if (!candidateIds.has(lookupKey))
						{
							continue;
						}

						const deviceName = (device.getName && typeof device.getName === 'function') ? device.getName() : 'Unknown webhook device';
						// Cache the successful mapping so next webhook can be routed without a full scan.
						registration = { device, name: deviceName, id: lookupKey, address: this.normalizeBLEAdvertisementId(deviceData && deviceData.address ? deviceData.address : null) };
						this.webhookDeviceRegistry.set(lookupKey, registration);
						if (registration.address)
						{
							this.webhookDeviceRegistry.set(registration.address, registration);
						}
						break;
					}
					if (registration && registration.device)
					{
						break;
					}
				}
			}

			if (!registration || !registration.device || (typeof registration.device.processWebhookMessage !== 'function'))
			{
				continue;
			}

			if (!devices.includes(registration.device))
			{
				devices.push(registration.device);
			}
		}

		return devices;
	}

	async processWebhookMessage(message)
	{
		this.updateLog(`Got a webhook message! ${this.varToString(message)}`, 1, 'hub');

		// Determine which devices should receive the webhook message.
		const directDevices = this.getWebhookDispatchDevices(message);
		if (directDevices.length === 0)
		{
			// No devices were found to handle the webhook message. Log diagnostic information for debugging.
			const context = message && message.context ? message.context : (message || {});
			const ignoredKeys = new Set();
			for (const rawKey of [context.deviceMac, context.deviceId, message && message.deviceMac, message && message.deviceId])
			{
				for (const key of this.getNormalizedLookupKeys(rawKey))
				{
					ignoredKeys.add(key);
				}
			}

			const registryMatches = [];
			// Diagnostics: compare lookup keys with cached registry entries and live runtime devices.
			for (const key of ignoredKeys)
			{
				const registration = this.webhookDeviceRegistry.get(key);
				if (registration)
				{
					const hasHandler = Boolean(registration.device && (typeof registration.device.processWebhookMessage === 'function'));
					registryMatches.push(`${key}->${registration.name || 'unknown'} (handler: ${hasHandler})`);
				}
			}

			const runtimeMatches = [];
			const drivers = this.homey && this.homey.drivers ? this.homey.drivers.getDrivers() : {};
			for (const driver of Object.values(drivers))
			{
				const driverDevices = driver && typeof driver.getDevices === 'function' ? driver.getDevices() : {};
				for (const device of Object.values(driverDevices))
				{
					if (!device || typeof device.getData !== 'function')
					{
						continue;
					}

					const deviceData = device.getData();
					const candidateKeys = new Set([
						...this.getNormalizedLookupKeys(deviceData && (deviceData.id || deviceData.pid) ? (deviceData.id || deviceData.pid) : null),
						...this.getNormalizedLookupKeys(deviceData && deviceData.address ? deviceData.address : null),
					]);

					let hasMatch = false;
					for (const key of ignoredKeys)
					{
						if (candidateKeys.has(key))
						{
							hasMatch = true;
							break;
						}
					}

					if (!hasMatch)
					{
						continue;
					}

					const name = (device.getName && typeof device.getName === 'function') ? device.getName() : 'Unknown device';
					const hasHandler = (typeof device.processWebhookMessage === 'function');
					runtimeMatches.push(`${name} (handler: ${hasHandler})`);
					if (runtimeMatches.length >= 5)
					{
						break;
					}
				}

				if (runtimeMatches.length >= 5)
				{
					break;
				}
			}

			this.updateLog(`Ignored webhook message for unregistered cloud/hub device (lookup keys: ${Array.from(ignoredKeys).join(', ') || 'none'}; registry matches: ${registryMatches.join('; ') || 'none'}; runtime matches: ${runtimeMatches.join('; ') || 'none'})`, 2, 'hub');
			return;
		}

		// Dispatch the webhook message to each resolved device.
		for (const device of directDevices)
		{
			try
			{
				const deviceData = (device && typeof device.getData === 'function') ? device.getData() : null;
				const context = (message && message.context) ? message.context : (message || {});
				const originalDeviceMac = context && context.deviceMac ? context.deviceMac : null;
				const originalDeviceId = context && context.deviceId ? context.deviceId : null;
				const incomingKeys = new Set([
					...this.getNormalizedLookupKeys(originalDeviceMac),
					...this.getNormalizedLookupKeys(originalDeviceId),
				]);
				const candidateKeys = new Set([
					...this.getNormalizedLookupKeys(deviceData && (deviceData.id || deviceData.pid) ? (deviceData.id || deviceData.pid) : null),
					...this.getNormalizedLookupKeys(deviceData && deviceData.address ? deviceData.address : null),
				]);

				if (incomingKeys.size > 0)
				{
					let hasKeyMatch = false;
					for (const incomingKey of incomingKeys)
					{
						if (candidateKeys.has(incomingKey))
						{
							hasKeyMatch = true;
							break;
						}
					}

					if (!hasKeyMatch)
					{
						// Guardrail: never dispatch a webhook update to a device that does not share the incoming key.
						this.updateLog(`Skipping webhook dispatch for mismatched device mapping (incoming: ${Array.from(incomingKeys).join(', ') || 'none'}, candidate: ${Array.from(candidateKeys).join(', ') || 'none'})`, 0, 'hub');
						continue;
					}
				}

				const resolvedDeviceMac = deviceData && (deviceData.id || deviceData.pid || deviceData.address)
					? (deviceData.id || deviceData.pid || deviceData.address)
					: originalDeviceMac;
				const dispatchDeviceId = (deviceData && (deviceData.id || deviceData.pid || deviceData.address)) || 'unknown';
				const messageForDevice = {
					...(message || {}),
					context: {
						...((message && message.context) ? message.context : {}),
						deviceMac: resolvedDeviceMac,
					},
				};

				this.updateLog(`Dispatching webhook message to device ${dispatchDeviceId} (original deviceMac: ${originalDeviceMac || 'none'}, original deviceId: ${originalDeviceId || 'none'}, resolved deviceMac: ${resolvedDeviceMac || 'none'})`, 2, 'hub');

				await device.processWebhookMessage(messageForDevice);
			}
			catch (err)
			{
				this.updateLog(`Error processing webhook message! ${err.message}`, 0, 'hub');
			}
		}
	}

	async registerHomeyWebhook(DeviceMAC, device = null)
	{
		const lookupKey = this.normalizeBLEAdvertisementId(DeviceMAC);
		const hasWebhookHandler = (candidate) => Boolean(candidate && (typeof candidate.processWebhookMessage === 'function'));
		const registerWebhookKeys = (registration, values) =>
		{
			// Store multiple normalized key variants (with/without separators) for robust matching.
			for (const value of values)
			{
				for (const key of this.getNormalizedLookupKeys(value))
				{
					this.webhookDeviceRegistry.set(key, registration);
				}
			}
		};
		if (lookupKey)
		{
			if (device && device.getData)
			{
				if (!hasWebhookHandler(device))
				{
					// BLE-only devices can share ids with hub devices; keep them out of webhook routing.
					const skippedName = (device.getName && typeof device.getName === 'function') ? device.getName() : 'Unknown webhook device';
					this.updateLog(`Skipping webhook registry for ${skippedName}: no processWebhookMessage handler`, 2, 'hub');
				}
				else
				{
				const deviceData = device.getData();
				const deviceName = (device.getName && typeof device.getName === 'function') ? device.getName() : 'Unknown webhook device';
				const deviceId = this.normalizeBLEAdvertisementId(deviceData && (deviceData.id || deviceData.pid) ? (deviceData.id || deviceData.pid) : null);
				const deviceAddress = this.normalizeBLEAdvertisementId(deviceData && deviceData.address ? deviceData.address : null);
				const registration = { device, name: deviceName, id: deviceId, address: deviceAddress };
				registerWebhookKeys(registration, [deviceId, deviceAddress, lookupKey]);
				}
			}
			else
			{
				const drivers = this.homey && this.homey.drivers ? this.homey.drivers.getDrivers() : {};
				for (const driver of Object.values(drivers))
				{
					const devices = driver && typeof driver.getDevices === 'function' ? driver.getDevices() : {};
					for (const candidateDevice of Object.values(devices))
					{
						if (!candidateDevice || typeof candidateDevice.getData !== 'function')
						{
							continue;
						}

						if (!hasWebhookHandler(candidateDevice))
						{
							continue;
						}

						const data = candidateDevice.getData();
						const candidateKeys = new Set();
						for (const candidateValue of [data && (data.id || data.pid), data && data.address])
						{
							for (const key of this.getNormalizedLookupKeys(candidateValue))
							{
								candidateKeys.add(key);
							}
						}
						if (!candidateKeys.has(lookupKey))
						{
							continue;
						}

						const candidateName = (candidateDevice.getName && typeof candidateDevice.getName === 'function') ? candidateDevice.getName() : 'Unknown webhook device';
						const registration = { device: candidateDevice, name: candidateName, id: this.normalizeBLEAdvertisementId(data && (data.id || data.pid) ? (data.id || data.pid) : null), address: this.normalizeBLEAdvertisementId(data && data.address ? data.address : null) };
						registerWebhookKeys(registration, [registration.id, registration.address, lookupKey]);
						break;
					}
					if (this.webhookDeviceRegistry.has(lookupKey))
					{
						break;
					}
				}
			}
		}

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

		if (!this.switchBotWebhookTimerID)
		{
			this.updateLog(`Webhook auth mode: ${this.getWebhookAuthMode()}`, 1, 'hub');
			this.switchBotWebhookTimerID = this.homey.setTimeout(() => this.setupSwitchBotWebhook(), 5000);
		}

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
					const baseDelay = Math.min(5000 * (2 ** Math.min(this.webhookRetryCount - 1, 3)), 60000);
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
						const baseDelay = Math.min(5000 * (2 ** Math.min(this.webhookRetryCount - 1, 3)), 60000);
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
				const baseDelay = Math.min(5000 * (2 ** Math.min(this.webhookRetryCount - 1, 3)), 60000);
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
			let webhookClient = this.getFirstSavedOAuth2Client();
			let webhookClientType = 'OAuth2';

			if (!webhookClient)
			{
				if (this.openToken && this.openSecret)
				{
					webhookClient = this.hub;
					webhookClientType = 'API token';
					this.homey.app.updateLog('No OAuth client available, using API token/secret for SwitchBot webhook', 1, 'hub');
				}
				else
				{
					this.homey.app.updateLog('No OAuth client or API token/secret available to register the SwitchBot webhook', 0, 'hub');
					return false;
				}
			}

			if (webhookClient)
			{
				// Fetch any exitsing webhook
				const response1 = await webhookClient.getWebhook();
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
								this.homey.app.updateLog(`SwitchBot webhook already registered (${webhookClientType})`, 1, 'hub');
								return true;
							}

							// Delete the current web hook so we can replace it with ours
							const response2 = await webhookClient.deleteWebhook(body.urls[0]);
							if (response2)
							{
								if (response2.statusCode && response2.statusCode !== 100)
								{
									this.homey.app.updateLog(`Delete webhook failed\nInvalid response code: ${response2.statusCode}\nMessage: ${response2.message}`, 0, 'hub');
									return false;
								}

								this.homey.app.updateLog(`Deleted old webhook (${webhookClientType})`, 3, 'hub');
							}
						}
						else
						{
							this.homey.app.updateLog(`No existing SwitchBot webhook found (${webhookClientType})`, 3, 'hub');
						}
					}
				}

				const response = await webhookClient.setWebhook(Homey.env.WEBHOOK_URL);
				if (response)
				{
					if (!response.statusCode || response.statusCode !== 100)
					{
						this.homey.app.updateLog(`Invalid response code: ${response.statusCode}\nMessage: ${response.message}`, 0, 'hub');
						return false;
					}
					this.homey.app.updateLog(`Registered SwitchBot webhook (${webhookClientType})`, 1, 'hub');
					return true;
				}
				this.homey.app.updateLog(`No response when registering the SwitchBot webhook (${webhookClientType})`, 0, 'hub');
				return false;
			}
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
		if (!this.hasWebhookEligibleDevices())
		{
			if (this.switchBotWebhookTimerID)
			{
				this.homey.clearTimeout(this.switchBotWebhookTimerID);
				this.switchBotWebhookTimerID = null;
			}

			this.updateLog('Skipping SwitchBot webhook setup: no hub/cloud devices registered', 1, 'hub');
			this.webhookAuthMissingLogged = false;
			return;
		}

		if (!this.hasHubAuthAvailable())
		{
			if (this.switchBotWebhookTimerID)
			{
				this.homey.clearTimeout(this.switchBotWebhookTimerID);
				this.switchBotWebhookTimerID = null;
			}

			if (!this.webhookAuthMissingLogged)
			{
				this.updateLog('SwitchBot webhook setup paused: no OAuth session or API token/secret available.', 0, 'hub');
				this.webhookAuthMissingLogged = true;
			}

			this.switchBotWebhookTimerID = this.homey.setTimeout(() => this.setupSwitchBotWebhook(), WEBHOOK_AUTH_MISSING_INTERVAL_MS);
			return;
		}

		if (this.webhookAuthMissingLogged)
		{
			this.updateLog('SwitchBot webhook setup resumed: authentication is available again.', 1, 'hub');
			this.webhookAuthMissingLogged = false;
		}

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
			if (!savedSessions || Object.keys(savedSessions).length === 0)
			{
				this.cachedFirstOAuth2Client = null;
				this.cachedFirstOAuth2SessionId = null;
				return null;
			}

			const sessionIds = Object.keys(savedSessions);
			if (sessionIds && sessionIds.length > 0)
			{
				const firstSessionId = sessionIds[0];
				if (this.cachedFirstOAuth2Client && this.cachedFirstOAuth2SessionId === firstSessionId)
				{
					return this.cachedFirstOAuth2Client;
				}

				const client = this.getOAuth2Client({
					configId: 'default',
					sessionId: firstSessionId,
				});

				this.cachedFirstOAuth2Client = client;
				this.cachedFirstOAuth2SessionId = firstSessionId;
				return client;
			}

			return null;
		}
		catch (err)
		{
			this.cachedFirstOAuth2Client = null;
			this.cachedFirstOAuth2SessionId = null;
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

			const devices = response.body ? response.body : response;
			if (devices && devices.deviceList)
			{
				try
				{
					devices.sceneList = await this.hub.getScenes();
				}
				catch (err)
				{
					this.homey.app.updateLog(`getHUBDevices scenes error: ${err.message}`, 0, 'hub');
				}
				return devices;
			}

			throw (new Error(`No devices found: ${this.varToString(response)}`));
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
			this.updateLog('OAuth callback created', 0, 'hub');

			this.settingsOAuthFlows[flowId] = {
				sessionId,
				status: 'pending',
				startedAt: Date.now(),
			};

			// Set up the 'url' event listener first (before Promise)
			const urlPromise = new Promise((resolve) => {
				callback.on('url', (url) => {
					this.updateLog('OAuth callback URL received', 0, 'hub');
					resolve(url);
				});
			});

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
				new Promise((_, reject) => this.homey.setTimeout(() => reject(new Error('Timed out while preparing OAuth callback URL')), 15000)),
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

		if (!this.hasHubAuthAvailable())
		{
			if (!this.hubAuthMissingLogged)
			{
				this.homey.app.updateLog('Hub polling paused: no API key/secret or OAuth2 session available. Re-authenticate in app settings to restore control.', 0, 'hub');
				this.hubAuthMissingLogged = true;
			}

			if (this.hubDevices > 0)
			{
				this.timerHubID = this.homey.setTimeout(this.onHubPoll, HUB_POLL_MISSING_AUTH_INTERVAL_MS);
			}

			return;
		}

		if (this.hubAuthMissingLogged)
		{
			this.homey.app.updateLog('Hub polling resumed: authentication is available again.', 1, 'hub');
			this.hubAuthMissingLogged = false;
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

	getBLEDeviceSubscriptionKey(device)
	{
		if (!device)
		{
			return null;
		}

		let key = this.bleAdvertisementDeviceKeys.get(device);
		if (!key)
		{
			key = `ble-device-${this.bleAdvertisementNextKey++}`;
			this.bleAdvertisementDeviceKeys.set(device, key);
		}

		return key;
	}

	getOrCreateBLEAdvertisementDeviceState(deviceKey, device = null)
	{
		if (!deviceKey)
		{
			return null;
		}

		let state = this.bleAdvertisementDeviceState.get(deviceKey);
		if (!state)
		{
			state = {
				device: device || null,
				bleId: null,
				localSeenAt: 0,
				lastRSSI: null,
				payloadFingerprint: null,
				parsedStateFingerprint: null,
				parsedSeenAt: 0,
				noServiceDataCount: 0,
				serviceDataPresentCount: 0,
				advertisementCount: 0,
				pollCount: 0,
			};
			this.bleAdvertisementDeviceState.set(deviceKey, state);
		}

		if (device)
		{
			state.device = device;
		}

		return state;
	}

	markBLEPollServiceData(device, hasServiceData, rssi = null)
	{
		if (!device)
		{
			return;
		}

		const deviceKey = this.getBLEDeviceSubscriptionKey(device);
		if (!deviceKey)
		{
			return;
		}

		const state = this.getOrCreateBLEAdvertisementDeviceState(deviceKey, device);
		if (typeof rssi === 'number' && Number.isFinite(rssi))
		{
			state.lastRSSI = rssi;
		}

		if (hasServiceData)
		{
			state.serviceDataPresentCount = Number(state.serviceDataPresentCount || 0) + 1;
			state.localSeenAt = Date.now();
		}
		else
		{
			state.noServiceDataCount = Number(state.noServiceDataCount || 0) + 1;
		}
	}

	markBLEDeviceSeenFromPoll(device)
	{
		this.markBLEPollServiceData(device, true);
	}

	normalizeBLEAdvertisementId(bleId)
	{
		if (!bleId)
		{
			return null;
		}

		return String(bleId).trim().toLowerCase();
	}

	getNormalizedLookupKeys(value)
	{
		const normalized = this.normalizeBLEAdvertisementId(value);
		if (!normalized)
		{
			return [];
		}

		const keys = new Set([normalized]);
		const compactHex = normalized.replace(/[^a-f0-9]/g, '');
		if (compactHex.length === 12)
		{
			keys.add(compactHex);
			keys.add(compactHex.match(/.{1,2}/g).join(':'));
		}

		return Array.from(keys);
	}

	registerBLEDeviceAdvertisement(device)
	{
		if (!device)
		{
			return null;
		}

		const deviceData = (device.getData && typeof device.getData === 'function') ? device.getData() : null;
		const name = (device.getName && typeof device.getName === 'function') ? device.getName() : 'Unknown BLE device';
		const deviceId = this.normalizeBLEAdvertisementId(deviceData && (deviceData.id || deviceData.pid) ? (deviceData.id || deviceData.pid) : null);
		const deviceAddress = this.normalizeBLEAdvertisementId(deviceData && deviceData.address ? deviceData.address : null);
		const deviceBleId = this.normalizeBLEAdvertisementId(deviceData && deviceData.id ? deviceData.id : null);
		const registration = { device, name, address: deviceAddress, id: deviceId, bleId: deviceBleId };
		const keys = new Set([
			...this.getNormalizedLookupKeys(deviceBleId),
			...this.getNormalizedLookupKeys(deviceId),
			...this.getNormalizedLookupKeys(deviceAddress),
		]);

		for (const key of keys)
		{
			this.bleAdvertisementDeviceRegistry.set(key, registration);
		}

		return registration;
	}

	unregisterBLEDeviceAdvertisement(device)
	{
		if (!device)
		{
			return;
		}

		const deviceData = (device.getData && typeof device.getData === 'function') ? device.getData() : null;
		const deviceId = this.normalizeBLEAdvertisementId(deviceData && (deviceData.id || deviceData.pid) ? (deviceData.id || deviceData.pid) : null);
		const deviceAddress = this.normalizeBLEAdvertisementId(deviceData && deviceData.address ? deviceData.address : null);
		const deviceBleId = this.normalizeBLEAdvertisementId(deviceData && deviceData.id ? deviceData.id : null);
		const keys = new Set([
			...this.getNormalizedLookupKeys(deviceBleId),
			...this.getNormalizedLookupKeys(deviceId),
			...this.getNormalizedLookupKeys(deviceAddress),
		]);
		for (const key of keys)
		{
			if (key && this.bleAdvertisementDeviceRegistry.get(key)?.device === device)
			{
				this.bleAdvertisementDeviceRegistry.delete(key);
			}
		}
	}

	bufferLikeToHex(value)
	{
		if (!value)
		{
			return '';
		}

		if (Buffer.isBuffer(value))
		{
			return value.toString('hex');
		}

		if (value instanceof Uint8Array)
		{
			return Buffer.from(value).toString('hex');
		}

		if (Array.isArray(value))
		{
			return Buffer.from(value).toString('hex');
		}

		if (value && value.type === 'Buffer' && Array.isArray(value.data))
		{
			return Buffer.from(value.data).toString('hex');
		}

		return String(value);
	}

	formatBLEAdvertisementSummary(advertisement, fallbackId = '')
	{
		const payload = advertisement && typeof advertisement === 'object' ? advertisement : {};
		const rawAddress = payload.address || payload.id || payload.pid || payload.uuid || fallbackId || 'unknown';
		const compactAddress = String(rawAddress).replace(/[^a-fA-F0-9]/g, '');
		const mac = compactAddress.length === 12
			? (compactAddress.match(/.{1,2}/g) || []).join(':').toUpperCase()
			: String(rawAddress).toUpperCase();
		let serviceEntries = [];

		if (Array.isArray(payload.serviceData))
		{
			serviceEntries = payload.serviceData.map((entry) => ({
				uuid: String((entry && entry.uuid) || '').toLowerCase(),
				data: this.bufferLikeToHex(entry && entry.data),
			}));
		}
		else if (payload.serviceData && typeof payload.serviceData === 'object')
		{
			serviceEntries = Object.entries(payload.serviceData).map(([uuid, data]) => ({
				uuid: String(uuid).toLowerCase(),
				data: this.bufferLikeToHex(data),
			}));
		}

		const manufacturerData = this.bufferLikeToHex(payload.manufacturerData);
		return `MAC: ${mac}, Service: ${JSON.stringify(serviceEntries)}, Manufacturer: ${manufacturerData || 'missing'}`;
	}

	getBLEAdvertisementFingerprint(advertisement)
	{
		if (!advertisement)
		{
			return 'md:|sd:';
		}

		const manufacturerDataHex = this.bufferLikeToHex(advertisement.manufacturerData);
		let serviceDataText = '';

		if (Array.isArray(advertisement.serviceData))
		{
			serviceDataText = advertisement.serviceData
				.map((entry) =>
				{
					const uuid = entry && entry.uuid ? String(entry.uuid).toLowerCase() : '';
					const dataHex = this.bufferLikeToHex(entry && entry.data ? entry.data : '');
					return `${uuid}:${dataHex}`;
				})
				.join('|');
		}
		else if (advertisement.serviceData && typeof advertisement.serviceData === 'object')
		{
			serviceDataText = Object.keys(advertisement.serviceData)
				.sort()
				.map((key) => `${String(key).toLowerCase()}:${this.bufferLikeToHex(advertisement.serviceData[key])}`)
				.join('|');
		}
		else
		{
			serviceDataText = this.bufferLikeToHex(advertisement.serviceData);
		}

		return `md:${manufacturerDataHex}|sd:${serviceDataText}`;
	}

	getBLEUnparsedReason(advertisement)
	{
		if (!advertisement)
		{
			return 'empty-advertisement';
		}

		const hasNoServiceData = !advertisement.serviceData || (Array.isArray(advertisement.serviceData)
			? advertisement.serviceData.length === 0
			: Object.keys(advertisement.serviceData).length === 0);

		if (hasNoServiceData)
		{
			if (advertisement.localName === 'WoHand')
			{
				return 'bot-no-service-data-fallback';
			}

			return 'no-service-data';
		}

		let serviceEntry = null;
		if (Array.isArray(advertisement.serviceData))
		{
			serviceEntry = advertisement.serviceData[0];
		}
		else if (advertisement.serviceData && typeof advertisement.serviceData === 'object')
		{
			const firstEntry = Object.entries(advertisement.serviceData)[0];
			if (firstEntry)
			{
				serviceEntry = { uuid: firstEntry[0], data: firstEntry[1] };
			}
		}

		if (!serviceEntry)
		{
			return 'service-data-not-array';
		}

		const { uuid } = serviceEntry;
		if (typeof uuid !== 'string')
		{
			return 'service-uuid-missing';
		}

		if ((uuid.search('0d00') < 0) && (uuid.search('fd3d') < 0))
		{
			return 'service-uuid-mismatch';
		}

		const rawBuffer = serviceEntry.data;
		let buf = null;
		if (Buffer.isBuffer(rawBuffer))
		{
			buf = rawBuffer;
		}
		else if (rawBuffer instanceof Uint8Array || Array.isArray(rawBuffer))
		{
			buf = Buffer.from(rawBuffer);
		}
		else if (rawBuffer && rawBuffer.type === 'Buffer' && Array.isArray(rawBuffer.data))
		{
			buf = Buffer.from(rawBuffer.data);
		}

		if (!buf || buf.length < 3)
		{
			return 'service-buffer-invalid';
		}

		const model = buf.slice(0, 1).toString('utf8');
		const knownModels = ['H', 'T', 'i', 'c', '{', 's', 'd', 'u', 'w', 'W', 'x', '&', '4', '5', '?', "'", ','];
		if (knownModels.includes(model))
		{
			return 'parser-returned-null';
		}

		if ((buf.length === 7) && (buf[5] === 0xcc) && (buf[6] === 0xc8) && ((buf[4] === 0x00) || (buf[4] === 0x10)))
		{
			if (!advertisement.manufacturerData || !Buffer.isBuffer(advertisement.manufacturerData) || (advertisement.manufacturerData.length < 12))
			{
				return 'presence-mm-manufacturer-invalid';
			}

			return 'presence-mm-parse-failed';
		}

		return `unknown-model:${model}`;
	}

	toStableJSONString(value)
	{
		if (Array.isArray(value))
		{
			return `[${value.map((entry) => this.toStableJSONString(entry)).join(',')}]`;
		}

		if (value && typeof value === 'object')
		{
			const keys = Object.keys(value).sort();
			return `{${keys.map((key) => `${JSON.stringify(key)}:${this.toStableJSONString(value[key])}`).join(',')}}`;
		}

		return JSON.stringify(value);
	}

	stripVolatileParsedFields(parsedEvent)
	{
		if (!parsedEvent || typeof parsedEvent !== 'object')
		{
			return parsedEvent;
		}

		const normalized = {
			...parsedEvent,
			serviceData: parsedEvent.serviceData && typeof parsedEvent.serviceData === 'object'
				? { ...parsedEvent.serviceData }
				: parsedEvent.serviceData,
		};

		if (!normalized.serviceData || typeof normalized.serviceData !== 'object')
		{
			return normalized;
		}

		const { modelName } = normalized.serviceData;
		const { model } = normalized.serviceData;
		if ((modelName === 'Presence(mm)') || (modelName === 'WoPresence') || (model === 's'))
		{
			delete normalized.serviceData.duration;
			delete normalized.serviceData.seq_number;
		}

		return normalized;
	}

	getBLEParsedStateFingerprint(parsedEvent)
	{
		return this.toStableJSONString(this.stripVolatileParsedFields(parsedEvent));
	}

	registerBLEPollingFallback(deviceKey = null)
	{
		if (deviceKey)
		{
			if (this.blePollingFallbackDevices.has(deviceKey))
			{
				return;
			}

			this.blePollingFallbackDevices.add(deviceKey);
		}

		this.bleDevices++;
		if (this.bleTimerID === null)
		{
			this.bleTimerID = this.homey.setTimeout(this.onBLEPoll, BLE_POLLING_INTERVAL);
		}
	}

	unregisterBLEPollingFallback(deviceKey = null)
	{
		if (deviceKey)
		{
			if (!this.blePollingFallbackDevices.has(deviceKey))
			{
				return;
			}

			this.blePollingFallbackDevices.delete(deviceKey);
		}

		this.bleDevices = Math.max(0, this.bleDevices - 1);
		if ((this.bleDevices === 0) && (this.bleTimerID !== null))
		{
			this.homey.clearTimeout(this.bleTimerID);
			this.bleTimerID = null;
		}
	}

	registerBLEPolling(device)
	{
		const deviceKey = this.getBLEDeviceSubscriptionKey(device);
		if (!deviceKey)
		{
			this.updateLog('BLE polling registration skipped: invalid device', 0, 'ble');
			return;
		}

		if (!this.bleRegisteredDevices.has(deviceKey))
		{
			this.bleRegisteredDevices.add(deviceKey);
		}

		if (this.bleTimerID === null)
		{
			this.bleTimerID = this.homey.setTimeout(this.onBLEPoll, BLE_POLLING_INTERVAL);
		}

		if (!this.bleAdvertisementSupported || !device)
		{
			this.registerBLEPollingFallback(deviceKey);
			return;
		}

		this.registerBLEDeviceAdvertisement(device);
		this.registerBLEAdvertisementSubscription(device)
			.catch((err) =>
			{
				const name = (device.getName && typeof device.getName === 'function') ? device.getName() : 'Unknown BLE device';
				this.updateLog(`BLE advertisement subscription failed for ${name}: ${err.message}. Using polling fallback.`, 0, 'ble');
				this.registerBLEPollingFallback(deviceKey);
			});
	}

	unregisterBLEPolling(device)
	{
		const deviceKey = this.getBLEDeviceSubscriptionKey(device);
		if (deviceKey)
		{
			this.bleRegisteredDevices.delete(deviceKey);
			const state = this.bleAdvertisementDeviceState.get(deviceKey);
			if (state)
			{
				state.parsedSeenAt = 0;
			}
		}

		if (this.bleAdvertisementSupported && device)
		{
			this.unregisterBLEDeviceAdvertisement(device);
			this.unregisterBLEAdvertisementSubscription(device)
				.catch((err) =>
				{
					const name = (device.getName && typeof device.getName === 'function') ? device.getName() : 'Unknown BLE device';
					this.updateLog(`BLE advertisement unsubscribe failed for ${name}: ${err.message}`, 0, 'ble');
				});
		}

		this.unregisterBLEPollingFallback(deviceKey);
	}

	async registerBLEAdvertisementSubscription(device)
	{
		const key = this.getBLEDeviceSubscriptionKey(device);
		if (!key)
		{
			throw new Error('Invalid BLE device registration');
		}

		const state = this.getOrCreateBLEAdvertisementDeviceState(key, device);
		if (state && state.bleId)
		{
			return;
		}

		const deviceData = (device.getData && typeof device.getData === 'function') ? device.getData() : null;
		this.registerBLEDeviceAdvertisement(device);
		const bleId = this.normalizeBLEAdvertisementId(deviceData && deviceData.id ? deviceData.id : null);
		if (!bleId)
		{
			throw new Error('Missing BLE advertisement id');
		}

		const existingSubscription = this.bleAdvertisementSubscriptions.get(bleId);
		if (existingSubscription)
		{
			existingSubscription.devices.set(key, device);
			state.bleId = bleId;
			return;
		}

		const pendingSubscription = this.bleAdvertisementSubscriptionPending.get(bleId);
		if (pendingSubscription)
		{
			await pendingSubscription;

			const subscribed = this.bleAdvertisementSubscriptions.get(bleId);
			if (!subscribed)
			{
				throw new Error(`BLE advertisement subscription for ${bleId} was not created`);
			}

			subscribed.devices.set(key, device);
			state.bleId = bleId;
			return;
		}

		const devices = new Map();
		devices.set(key, device);

		const callback = async (advertisement) =>
		{
			await this.handleBLEAdvertisement(bleId, advertisement);
		};

		const subscribePromise = this.homey.ble.subscribeToAdvertisements(
			bleId,
			{ rateLimitMs: BLE_ADVERTISEMENT_RATE_LIMIT_MS },
			callback,
		)
			.catch(async (err) =>
			{
				const message = (err && err.message) ? err.message : String(err);
				const alreadyExported = /AdvertisementMonitor1.+already exported/i.test(message);
				if (!alreadyExported)
				{
					throw err;
				}

				this.updateLog(`BLE advertisement monitor already exported for ${bleId}, retrying subscription once`, 1, 'ble');

				try
				{
					await this.homey.ble.unsubscribeFromAdvertisements(bleId);
				}
				catch (unsubscribeErr)
				{
					this.updateLog(`BLE advertisement unsubscribe before retry failed for ${bleId}: ${unsubscribeErr.message}`, 2, 'ble');
				}

				await this.homey.ble.subscribeToAdvertisements(
					bleId,
					{ rateLimitMs: BLE_ADVERTISEMENT_RATE_LIMIT_MS },
					callback,
				);
			})
			.then(() =>
			{
				this.bleAdvertisementSubscriptions.set(bleId, { callback, devices });
			});

		this.bleAdvertisementSubscriptionPending.set(bleId, subscribePromise);

		try
		{
			await subscribePromise;
			state.bleId = bleId;
		}
		finally
		{
			this.bleAdvertisementSubscriptionPending.delete(bleId);
		}

		const name = (device.getName && typeof device.getName === 'function') ? device.getName() : bleId;
		this.updateLog(`Subscribed to BLE advertisements for ${name}`, 2, 'ble');
	}

	async unregisterBLEAdvertisementSubscription(device)
	{
		const key = this.getBLEDeviceSubscriptionKey(device);
		if (!key)
		{
			return;
		}

		const state = this.bleAdvertisementDeviceState.get(key);
		const bleId = this.normalizeBLEAdvertisementId(state && state.bleId);
		if (!bleId)
		{
			return;
		}

		const pendingSubscription = this.bleAdvertisementSubscriptionPending.get(bleId);
		if (pendingSubscription)
		{
			await pendingSubscription.catch(() => null);
		}

		if (state)
		{
			state.bleId = null;
			state.payloadFingerprint = null;
			state.parsedStateFingerprint = null;
			state.parsedSeenAt = 0;
			state.localSeenAt = 0;
			state.lastRSSI = null;
			state.noServiceDataCount = 0;
			state.serviceDataPresentCount = 0;
			state.advertisementCount = 0;
			state.pollCount = 0;
		}

		const subscription = this.bleAdvertisementSubscriptions.get(bleId);
		if (!subscription)
		{
			return;
		}

		subscription.devices.delete(key);
		if (subscription.devices.size > 0)
		{
			return;
		}

		await this.homey.ble.unsubscribeFromAdvertisements(bleId);
		this.bleAdvertisementSubscriptions.delete(bleId);
	}

	async unregisterAllBLEAdvertisementSubscriptions()
	{
		const pendingSubscriptions = Array.from(this.bleAdvertisementSubscriptionPending.values());
		if (pendingSubscriptions.length > 0)
		{
			await Promise.allSettled(pendingSubscriptions);
		}

		const bleIds = Array.from(this.bleAdvertisementSubscriptions.keys());
		for (const bleId of bleIds)
		{
			try
			{
				await this.homey.ble.unsubscribeFromAdvertisements(bleId);
			}
			catch (err)
			{
				this.updateLog(`Failed to unsubscribe BLE advertisements for ${bleId}: ${err.message}`, 0, 'ble');
			}
		}

		this.bleAdvertisementSubscriptions.clear();
		this.bleAdvertisementSubscriptionPending.clear();
		this.bleAdvertisementDeviceState.clear();
		this.blePollingFallbackDevices.clear();
		this.bleRegisteredDevices.clear();
	}

	getBLERegisteredDevices()
	{
		const devices = new Map();
		const registrations = this.bleAdvertisementDeviceRegistry.values();
		for (const registration of registrations)
		{
			if (!registration || !registration.device || typeof registration.device.syncBLEEvents !== 'function')
			{
				continue;
			}

			const deviceKey = this.getBLEDeviceSubscriptionKey(registration.device);
			if (deviceKey)
			{
				devices.set(deviceKey, registration.device);
			}
		}

		return devices;
	}

	clearBLEStatistics(preserveLastSeen = true)
	{
		for (const state of this.bleAdvertisementDeviceState.values())
		{
			if (!state)
			{
				continue;
			}

			if (!preserveLastSeen)
			{
				state.localSeenAt = 0;
				state.parsedSeenAt = 0;
			}

			state.noServiceDataCount = 0;
			state.serviceDataPresentCount = 0;
			state.advertisementCount = 0;
			state.pollCount = 0;
			state.lastRSSI = null;
		}

		return true;
	}

	getBLEStatistics()
	{
		const rows = [];
		for (const [deviceKey, state] of this.bleAdvertisementDeviceState.entries())
		{
			if (!state)
			{
				continue;
			}

			const { device } = state;
			const deviceData = (device && device.getData && typeof device.getData === 'function') ? device.getData() : null;
			const name = (device && device.getName && typeof device.getName === 'function') ? device.getName() : (state.bleId || deviceKey);
			const mac = this.normalizeBLEAdvertisementId(deviceData && deviceData.address ? deviceData.address : null)
				|| this.normalizeBLEAdvertisementId(deviceData && (deviceData.id || deviceData.pid) ? (deviceData.id || deviceData.pid) : null)
				|| state.bleId
				|| '';
			const driverType = String((device && device.driver && (device.driver.id || (device.driver.manifest && device.driver.manifest.id))) || 'unknown');
			const lastSeenAt = Math.max(state.localSeenAt || 0, state.parsedSeenAt || 0);
			rows.push({
				name,
				mac,
				driverType,
				missing: Number(state.noServiceDataCount || 0),
				present: Number(state.serviceDataPresentCount || 0),
				advertisements: Number(state.advertisementCount || 0),
				rssi: (typeof state.lastRSSI === 'number' && Number.isFinite(state.lastRSSI)) ? Math.round(state.lastRSSI) : null,
				lastSeenAt,
				polls: Number(state.pollCount || 0),
			});
		}

		rows.sort((a, b) => a.name.localeCompare(b.name));
		return rows;
	}

	getBLEAdvertisementDispatchDevicesForAdvertisement(bleId, advertisement)
	{
		const lookupKeys = new Set();
		for (const value of [
			advertisement && advertisement.address,
			bleId,
			advertisement && advertisement.id,
			advertisement && advertisement.pid,
			advertisement && advertisement.uuid,
		])
		{
			for (const key of this.getNormalizedLookupKeys(value))
			{
				lookupKeys.add(key);
			}
		}

		if (lookupKeys.size === 0)
		{
			this.updateLog(`[filter] BLE advertisement ignored for unregistered device ${bleId || advertisement?.address || 'unknown'} (address=${advertisement?.address || 'n/a'}, name=${advertisement?.localName || 'n/a'})`, 2, 'ble');
			return [];
		}

		let registration = null;
		let matchedKey = null;
		for (const key of lookupKeys)
		{
			registration = this.bleAdvertisementDeviceRegistry.get(key);
			if (registration)
			{
				matchedKey = key;
				break;
			}
		}
		if (!registration || !registration.device || typeof registration.device.syncBLEEvents !== 'function')
		{
			this.updateLog(`[filter] BLE advertisement ignored for unregistered address ${Array.from(lookupKeys)[0]}`, 2, 'ble');
			return [];
		}

		this.updateLog(`[filter] BLE advertisement matched registered device ${registration.name || registration.device.getName?.() || matchedKey} for ${matchedKey}`, 3, 'ble');
		return [registration.device];
	}

	getBLEAdvertisementWebhookSummary(device, parsedEvent, bleId)
	{
		let deviceName = bleId;
		if (parsedEvent && parsedEvent.address)
		{
			deviceName = parsedEvent.address;
		}
		if (device && device.getName && typeof device.getName === 'function')
		{
			deviceName = device.getName();
		}
		const summaryParts = [];

		if (parsedEvent && parsedEvent.address)
		{
			summaryParts.push(`address=${parsedEvent.address}`);
		}

		if (parsedEvent && typeof parsedEvent.rssi !== 'undefined')
		{
			summaryParts.push(`rssi=${parsedEvent.rssi}`);
		}

		if (parsedEvent && parsedEvent.serviceData && typeof parsedEvent.serviceData === 'object')
		{
			const { serviceData } = parsedEvent;
			if (serviceData.modelName)
			{
				summaryParts.push(`model=${serviceData.modelName}`);
			}

			for (const key of ['battery', 'position', 'motion', 'contact', 'leftOpen', 'light', 'presence', 'temperature', 'humidity', 'light_level', 'trigger_flag', 'buttonPresses', 'entryCount', 'exitCount', 'lastMotion', 'lastContact'])
			{
				if (typeof serviceData[key] !== 'undefined')
				{
					summaryParts.push(`${key}=${serviceData[key]}`);
				}
			}
		}

		if (summaryParts.length === 0)
		{
			return `${deviceName}: decoded values unavailable`;
		}

		return `${deviceName}: ${summaryParts.join(', ')}`;
	}

	isBLEParsedEventForDevice(device, parsedEvent)
	{
		if (!device || !parsedEvent)
		{
			return false;
		}

		const deviceData = (device.getData && typeof device.getData === 'function') ? device.getData() : null;
		if (!deviceData)
		{
			return true;
		}

		const normalize = (value) => String(value || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase();

		const eventAddress = normalize(parsedEvent.address);
		const deviceAddress = normalize(deviceData.address);
		if (eventAddress && deviceAddress)
		{
			return eventAddress === deviceAddress;
		}

		const eventId = normalize(parsedEvent.id || parsedEvent.pid || parsedEvent.uuid);
		const deviceId = normalize(deviceData.id || deviceData.pid);
		if (eventId && deviceId)
		{
			return eventId === deviceId;
		}

		return true;
	}

	async handleBLEAdvertisement(bleId, advertisement)
	{
		this.updateLog(this.formatBLEAdvertisementSummary(advertisement, bleId), 2, 'ble');
		this.updateLog(`[detailed] BLE advertisement payload received for ${bleId}: ${this.varToString(advertisement)}`, 3, 'ble');
		const devices = this.getBLEAdvertisementDispatchDevicesForAdvertisement(bleId, advertisement);
		if (devices.length === 0)
		{
			return;
		}

		const device = devices[0];
		try
		{
			if (!device || !device.syncBLEEvents)
			{
				return;
			}

			const deviceKey = this.getBLEDeviceSubscriptionKey(device);
			if (!deviceKey)
			{
				return;
			}

			const state = this.getOrCreateBLEAdvertisementDeviceState(deviceKey, device);
			state.advertisementCount = Number(state.advertisementCount || 0) + 1;
			if (typeof advertisement?.rssi === 'number' && Number.isFinite(advertisement.rssi))
			{
				state.lastRSSI = advertisement.rssi;
			}
			const payloadFingerprint = this.getBLEAdvertisementFingerprint(advertisement);
			const previousFingerprint = state.payloadFingerprint;

			const serviceDataIsPresent = !!advertisement
				&& !!advertisement.serviceData
				&& (
					(Array.isArray(advertisement.serviceData) && advertisement.serviceData.length > 0)
					|| (!Array.isArray(advertisement.serviceData)
						&& typeof advertisement.serviceData === 'object'
						&& Object.keys(advertisement.serviceData).length > 0)
				);
			if (serviceDataIsPresent)
			{
				state.serviceDataPresentCount++;
			}

			const reason = this.getBLEUnparsedReason(advertisement);
			if (reason === 'no-service-data')
			{
				state.noServiceDataCount++;
			}

			if (reason === 'no-service-data' || reason === 'service-data-not-array' || reason === 'service-uuid-missing' || reason === 'service-uuid-mismatch' || reason === 'service-buffer-invalid')
			{
				this.updateLog(`[filter] BLE advertisement rejected for ${device.getName?.() || bleId}: ${reason}`, 3, 'ble');
				return;
			}

			const nowMs = Date.now();
			const previousSeenMs = state.localSeenAt || 0;
			state.localSeenAt = nowMs;
			if ((nowMs - previousSeenMs) >= 60000)
			{
				const name = (device.getName && typeof device.getName === 'function') ? device.getName() : bleId;
				this.updateLog(`[local-subscription] BLE advertisement received for ${name} (${bleId})`, 1, 'ble');
			}

			if (previousFingerprint === payloadFingerprint)
			{
				return;
			}

			state.payloadFingerprint = payloadFingerprint;

			let parsedEvent = null;
			if (device.driver && typeof device.driver.parse === 'function')
			{
				parsedEvent = device.driver.parse(advertisement);
			}

			if (parsedEvent)
			{
				if (!this.isBLEParsedEventForDevice(device, parsedEvent))
				{
					return;
				}

				state.parsedSeenAt = Date.now();

				const parsedStateFingerprint = this.getBLEParsedStateFingerprint(parsedEvent);
				const previousParsedStateFingerprint = state.parsedStateFingerprint;
				if (previousParsedStateFingerprint === parsedStateFingerprint)
				{
					return;
				}

				state.parsedStateFingerprint = parsedStateFingerprint;
				this.updateLog(`[advertisement/ble] ${this.getBLEAdvertisementWebhookSummary(device, parsedEvent, bleId)}`, 1, 'ble');
				this.updateLog(`[detailed] Parsed BLE advertisement for ${bleId}: ${this.varToString(parsedEvent)}`, 3, 'ble');
				await device.syncBLEEvents([parsedEvent]);
			}
			else
			{
				this.updateLog(`[detailed] Unparsed BLE advertisement for ${bleId} (${reason})`, 3, 'ble');
			}
		}
		catch (err)
		{
			const name = (device && device.getName && typeof device.getName === 'function') ? device.getName() : bleId;
			this.updateLog(`BLE advertisement handling failed for ${name}: ${err.message}`, 0, 'ble');
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
			const nowMs = Date.now();
			let staleFallbackPolls = 0;
			try
			{
				// Run discovery to fetch new data when available, but continue fallback polling if not.
				if (this.homey.ble && (typeof this.homey.ble.discover === 'function'))
				{
					try
					{
						await this.homey.ble.discover(['cba20d00224d11e69fb80002a5d5c51b'], 2000);
						this.updateLog('BLE Finished Discovery', 'hub');
					}
					catch (discoverErr)
					{
						this.updateLog(`BLE discovery unavailable during poll: ${discoverErr.message}. Continuing fallback polling.`, 1, 'ble');
					}
				}
				else if (!this.bleDiscoverUnavailableLogged)
				{
					this.bleDiscoverUnavailableLogged = true;
					this.updateLog('BLE discovery API unavailable on this Homey, using fallback polling only.', 1, 'ble');
				}

				const registeredDevices = this.getBLERegisteredDevices();
				for (const [deviceKey, device] of registeredDevices)
				{
					if (!device || !device.getDeviceValues)
					{
						continue;
					}

					if (!this.bleRegisteredDevices.has(deviceKey))
					{
						continue;
					}

					if (this.blePollingFallbackDevices.has(deviceKey) || !this.bleAdvertisementSupported)
					{
						const fallbackState = this.getOrCreateBLEAdvertisementDeviceState(deviceKey, device);
						fallbackState.pollCount = (fallbackState.pollCount || 0) + 1;
						promises.push(device.getDeviceValues());
						continue;
					}

					const state = this.getOrCreateBLEAdvertisementDeviceState(deviceKey, device);
					const lastLocalSeenAt = state.localSeenAt || 0;
					const lastParsedSeenAt = state.parsedSeenAt || 0;
					const lastSeenAt = Math.max(lastLocalSeenAt, lastParsedSeenAt);
					if (!lastSeenAt || ((nowMs - lastSeenAt) >= BLE_ADVERTISEMENT_STALE_POLL_MS))
					{
						state.pollCount = (state.pollCount || 0) + 1;
						staleFallbackPolls++;
						promises.push(device.getDeviceValues());
					}
				}

				if (staleFallbackPolls > 0)
				{
					this.updateLog(`BLE stale-subscription fallback polling for ${staleFallbackPolls} device(s)`, 1, 'ble');
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

		if (this.bleRegisteredDevices.size > 0)
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
