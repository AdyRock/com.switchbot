# SwitchBot

Adds support for SwitchBot BLE devices and connections via the hub.
* Currently only the curtain motors are supported.

# BLE Mode
Homey's BLE has issues caused by the way it implements caching and the lack of notification support. This means that it is not possible to get the current position and battery level. Hopefully the caching problem will be fixed in version 5 of Homey's firmware.
The other possible issue with BLE is the range, and Homey may not be able to reach the motors.

# Hub Mode
To use the hub, you need to obtain your developer token from the SwitchBot app. Open the app and navigate to the Profile - Preferences page. Tap on the App version line 10 times to enable developer mode. Select the new Developer Options line and copy the token. Then in the Home SwitchBot app, navigate to the Configuration page and paste the token into the API TOKEN field and then save the changes.

The SwitchBot API has a limit of 10000 accesses per day, which is around once every 8.7 seconds. Therefore to work out the lowest polling interval you need to multiply that by the number of devices, as getting the position of each device requires one access.
The limit means the app could be slow to respond to external changes to the curtain positions and therefore is only useful to control the devices and not responding to changes.
