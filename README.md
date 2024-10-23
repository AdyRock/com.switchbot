# SwitchBot

Adds support for SwitchBot BLE devices and connections via the hub.

# BLE Mode
Homey's BLE has issues caused by the way it implements.
The other possible issue with BLE is the range, and Homey may not be able to reach the devices.

# Hub Mode
The SwitchBot API has a limit of 10000 accesses per day per user, which is around once every 8.7 seconds. Therefore to work out the lowest polling interval you need to multiply that by the number of devices, as getting the position of each device requires one access. The app calculates the rate based on the number of device that need to be polled to ensure the limit is not exceeded.
The limit means the app could be slow to respond to some external changes, but most devices now support a webhook mechanism to receive updates, which is much faster and doesn't use the API allowance.

# Feature Requests
This app is limited to the features provided by the SwitchBot API. You can find more details and request further features via their repository:
https://github.com/OpenWonderLabs/SwitchBotAPI
