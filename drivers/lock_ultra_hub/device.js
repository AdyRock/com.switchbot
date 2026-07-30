/* jslint node: true */

'use strict';

const LockAdvancedHubDevice = require('../../lib/lock_advanced_hub_device');

class LockUltraHubDevice extends LockAdvancedHubDevice
{

	supportsDeadbolt()
	{
		return true;
	}

}

module.exports = LockUltraHubDevice;
