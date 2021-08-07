/*jslint node: true */
'use strict';

const Homey = require('homey');
const hubInterface = require("../hub_interface");

class HubDriver extends Homey.Driver
{
    /**
     * onInit is called when the driver is initialized.
     */
    async onInit()
    {
        this.hub = new hubInterface(this.homey);
    }

    async getHUBDevices(type, RemoteList = false)
    {
        return await this.hub.getHUBDevices(type, RemoteList);
    }
 
    async getScenes()
    {
        return await this.hub.getScenes();
    }
    
    async getDeviceData(deviceId)
    {
        return await this.hub.getDeviceData(deviceId);
    }

    async setDeviceData(deviceId, body)
    {
        return await this.hub.setDeviceData(deviceId, body);
    }

    async GetURL(url)
    {
        return await this.hub.GetURL(url);
    }

    async PostURL(url, body)
    {
        return await this.hub.PostURL(url, body);
    } 
}

module.exports = HubDriver;