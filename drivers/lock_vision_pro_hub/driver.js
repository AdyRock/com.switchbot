/* jslint node: true */

'use strict';

const LockAdvancedHubDriver = require('../../lib/lock_advanced_hub_driver');

class LockVisionProHubDriver extends LockAdvancedHubDriver
{

	getSupportedLockTypes()
	{
		return ['Lock Vision Pro'];
	}

}

module.exports = LockVisionProHubDriver;