/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class AIHubDevice extends HubDevice
{

	async getHubDeviceValues()
	{
		try
		{
			const data = await this._getHubDeviceValues();
			if (!data || (data.onlineStatus !== 'online' && data.onlineStatus !== 'offline'))
			{
				throw new Error(`Unexpected AI Hub online status: ${data && data.onlineStatus}`);
			}

			await this.setAvailable();
			await this.setCapabilityValue('alarm_generic', data.onlineStatus === 'offline');
			this.homey.app.updateLog(`AI Hub status: ${data.onlineStatus}`, 3, 'hub');
		}
		catch (err)
		{
			this.homey.app.updateLog(`AI Hub status request failed: ${err.message}`, 0, 'hub');
			this.setWarning(err.message).catch(this.error);
		}
	}

	async pollHubDeviceValues()
	{
		await this.getHubDeviceValues();
		return true;
	}

}

module.exports = AIHubDevice;
