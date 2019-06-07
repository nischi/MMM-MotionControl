/* Magic Mirror
 * Module: MMM-MotionControl
 *
 * By Thierry Nischelwitzer http://nischi.ch
 * MIT Licensed.
 */

Module.register("MMM-MotionControl",{
	defaults: {
    delay: 15000,
    useFacialRecognitionOCV3: false
  },

  timeout: null,

  notificationReceived: function(notification, payload, sender) {
    if (this.config.useFacialRecognitionOCV3 === true) {
      this.handleFacialRecognitionOCV3(notification, payload, sender);
    }
  },

  handleFacialRecognitionOCV3: function(notification, payload, sender) {
    _self = this;
    if (notification === 'CURRENT_USER') {
      Log.log(this.name + " received a module notification: " + notification + " with payload " + payload);

      if (payload === 'None') {
        _self.timeout = setTimeout(function() {
          this.sendNotification('CECControl', 'off');
        }, this.config.delay);
      } else {
        clearTimeout(_self.timeout);
        this.sendNotification('CECControl', 'on');
      }
    }
  }
});