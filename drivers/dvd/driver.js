/*jslint node: true */
'use strict';

const Homey = require('homey');
const HubDriver = require('../hub_driver');

class HubDVDDriver extends HubDriver
{
    /**
     * onInit is called when the driver is initialized.
     */
    async onInit()
    {
        super.onInit();
        this.log('HubDVDDriver has been initialized');

        const onAction = this.homey.flow.getActionCard('on');
        onAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityPowerOn();
            });

        const offAction = this.homey.flow.getActionCard('off');
        offAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityPowerOff();
            });

        const playAction = this.homey.flow.getActionCard('play');
        playAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityPlay();
            });

        const pauseAction = this.homey.flow.getActionCard('pause');
        pauseAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityPause();
            });

        const stopAction = this.homey.flow.getActionCard('stop');
        stopAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityStop();
            });

        const prevAction = this.homey.flow.getActionCard('prev');
        prevAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityPrev();
            });

        const nextAction = this.homey.flow.getActionCard('next');
        nextAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityNext();
            });

        const rewindAction = this.homey.flow.getActionCard('rewind');
        rewindAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityRewind();
            });

        const forwardAction = this.homey.flow.getActionCard('forward');
        forwardAction
            .registerRunListener(async (args, state) =>
            {
                return args.device.onCapabilityForward();
            });

    }

    /**
     * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
     * This should return an array with the data of devices that are available for pairing.
     */
    async onPairListDevices()
    {
        return this.getHUBDevices('DVD', true);
    }
}

module.exports = HubDVDDriver;