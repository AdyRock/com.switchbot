'use strict';

const Homey = require('homey');
const HubDriver = require('../hub_driver');

class HubCurtainDriver extends HubDriver
{
    /**
     * onInit is called when the driver is initialized.
     */
    async onInit()
    {
        this.log('MyDriver has been initialized');
    }

    /**
     * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
     * This should return an array with the data of devices that are available for pairing.
     */
    onPairListDevices( data, callback )
    {
        this.getHUBDevices('Curtain').then( function( devices )
        {
            //console.log( devices );
            callback( null, devices );

        } ).catch( function( err )
        {
            callback( err, [] );
        } );
    }
}

module.exports = HubCurtainDriver;