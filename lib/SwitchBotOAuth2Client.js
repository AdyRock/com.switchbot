/* jslint node: true */

'use strict';

const Homey = require('homey');
const { OAuth2Client, OAuth2Error } = require('homey-oauth2app');
const { OAuth2Token } = require('homey-oauth2app');

module.exports = class SwitchBotOAuth2Client extends OAuth2Client
{

    // Required:
    static API_URL = 'https://api.switch-bot.com/v1.0';
    static TOKEN_URL = `${Homey.env.COGNITO_DOMAIN}/oauth2/token`;
    static AUTHORIZATION_URL = `${Homey.env.COGNITO_DOMAIN}/login`;
    static SCOPES = ['phone', 'openid', 'email', 'profile'];

    // Optional:
    static TOKEN = OAuth2Token; // Default: OAuth2Token
    // static REDIRECT_URL = 'https://callback.athom.com/oauth2/callback'; // Default: 'https://callback.athom.com/oauth2/callback'

    // Overload what needs to be overloaded here

    async onHandleNotOK({ statusText })
    {
        throw new OAuth2Error(statusText);
    }

    async getDevices()
    {
        return this.get(
            {
                path: '/devices',
            },
        );
    }

    async getScenes()
    {
        return this.get(
            {
                path: '/scenes',
            },
        );
    }

    async getDeviceData(deviceId)
    {
        return this.get(
            {
                path: `/devices/${deviceId}/status`,
            },
        );
    }

    async setDeviceData(deviceId, data)
    {
        return this.post(
            {
                path: `/devices/${deviceId}/commands`,
                json: data,
            },
        );
    }

    async startScene(deviceId)
    {
        return this.post(
            {
                path: `/scenes/${deviceId}/execute`,
            },
        );
    }

};
