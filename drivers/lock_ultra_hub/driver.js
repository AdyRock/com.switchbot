/* jslint node: true */

'use strict';

const LockAdvancedHubDriver = require('../../lib/lock_advanced_hub_driver');

class LockUltraHubDriver extends LockAdvancedHubDriver
{

	getSupportedLockTypes()
	{
		return ['Smart Lock Pro', 'Smart Lock Ultra'];
	}

}

module.exports = LockUltraHubDriver;
