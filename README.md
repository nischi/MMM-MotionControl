# MMM-MotionControl

Detect motion on mirror and control the tv with my other Module [MMM-CECControl](https://github.com/nischi/MMM-CECControl "MMM-CECControl")

I try to implement different other modules as a hub. You can use [MMM-Facial-Recognition-OCV3](https://github.com/normyx/MMM-Facial-Recognition-OCV3 "MMM-Facial-Recognition-OCV3"), this module receive the notification and turn the tv on or off.

Added following module as well, [MMM-Face-Reco-DNN](https://github.com/nischi/MMM-Face-Reco-DNN "MMM-Face-Reco-DNN").

## Screenshot

We can't do a Screenshot because it runs in the background :) It's only react on some events to turn the TV on and off.

## Setup the Module

Config | Description
--- | ---
`delay` | Delay to turn the TV off after the off notification was sent. <br />**Default Value:** `15000`
`interval` | Interval to check modules. <br />**Default Value:** `5000`
`useFacialRecognitionOCV3`| Use the module MMM-Facial-Recognition-OCV3 to control the TV<br />**Default Value:** `false`
`useMMMFaceRecoDNN`| Use the module MMM-Face-Reco-DNN to control the TV<br />**Default Value:** `false`
`ontime`| Time where TV is always on. Array with times `['0700-1200', '1300-2000']`.<br />**Default Value:** `[]`

### Full configuration of the module

```javascript
{
    module: 'MMM-MotionControl',
    config: {
        // Delay to turn the TV off
        delay: 15000,
        // Interval to check modules
        interval: 5000,
        // Use the module MMM-Facial-Recognition-OCV3
        useFacialRecognitionOCV3: false,
        // Use the module MMM-Face-Reco-DNN
        useMMMFaceRecoDNN: false,
        // Array where tv should be on
        ontime: []
    }
}
```
