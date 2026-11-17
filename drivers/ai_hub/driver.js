/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class AIHubDriver extends HubDriver
{

	async onPairListDevices({ oAuth2Client })
	{
		return this.getHUBDevices(oAuth2Client, 'AI Hub', false);
	}

}

module.exports = AIHubDriver;
