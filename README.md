# MMM-MotionControl
Detect motion on mirror and control the tv with my other Module [MMM-CECControl](https://github.com/nischi/MMM-CECControl "MMM-CECControl")

I try to implement different other modules as a hub. You can use [MMM-Facial-Recognition-OCV3](https://github.com/normyx/MMM-Facial-Recognition-OCV3 "MMM-Facial-Recognition-OCV3"), this module receive the notification and turn the tv on or off.

## Screenshot
We can't do a Screenshot because it runs in the background :) It's only react on some events to turn the TV on and off.

## Setup the Module

Config | Description
--- | ---
`delay` | Delay to turn the TV off after the off notification was sent. <br />Default: `5000`
`useFacialRecognitionOCV3`| Use the module MMM-Facial-Recognition-OCV3 to control the TV<br />Default: `false`

### Full configuration of the module

```javascript
{
    module: 'MMM-CECControl',
    config: {
        // Delay to turn the TV off
        delay: 5000,
        // Use the module MMM-Facial-Recognition-OCV3
        useFacialRecognitionOCV3: false
    }
}
```