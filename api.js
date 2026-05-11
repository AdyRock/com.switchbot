/* jslint node: true */

'use strict';

module.exports = {
	async getLog({ homey, query })
	{
		return homey.app.diagLog;
	},
	async getDetect({ homey, query })
	{
		try
		{
			homey.app.detectedDevices = homey.app.varToString(await homey.app.getHUBDevices());
		}
		catch (err)
		{
			if (!homey.app.detectedDevices)
			{
				homey.app.detectedDevices = err.message;
			}
		}
		return homey.app.detectedDevices;
	},
	async clearLog({ homey, query })
	{
		homey.app.diagLog = '';
		return 'OK';
	},
	async SendDeviceLog({ homey, query })
	{
		return homey.app.sendLog('deviceLog');
	},
	async SendInfoLog({ homey, query })
	{
		return homey.app.sendLog('infoLog');
	},
	async SendStatusLog({ homey, query })
	{
		return homey.app.sendLog('statusLog');
	},
	async clearStatusLog({ homey, query })
	{
		homey.app.deviceStatusLog = '';
		return 'OK';
	},
	async newData({ homey, body })
	{
		if (homey.app.BLEHub)
		{
			homey.app.BLEHub.newBLEHubData(body);
		}
		return 'OK';
	},
	async requestDeviceStatus({ homey, query })
	{
		const retval = await homey.app.getDeviceStatus(query.deviceId);
		const data = JSON.stringify(retval, null, 2);
		homey.app.deviceStatusLog += data;
		return homey.app.deviceStatusLog;
	},
	async checkOAuthStatus({ homey, query })
	{
		try
		{
			const savedSessions = homey.app.getSavedOAuth2Sessions();
			// getSavedOAuth2Sessions returns an object of sessions by sessionId
			const hasSession = savedSessions && Object.keys(savedSessions).length > 0;
			return {
				hasOAuthSession: hasSession,
			};
		}
		catch (err)
		{
			return {
				hasOAuthSession: false,
			};
		}
	},
	async startOAuth2Flow({ homey, query })
	{
		try
		{
			const { authUrl, flowId } = await homey.app.startSettingsOAuthLogin();
			return {
				authUrl,
				flowId,
				success: true,
			};
		}
		catch (err)
		{
			return {
				success: false,
				error: err.message
			};
		}
	},
};
