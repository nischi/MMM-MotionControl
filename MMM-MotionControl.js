/* Magic Mirror
 * Module: MMM-MotionControl
 *
 * By Thierry Nischelwitzer http://nischi.ch
 * MIT Licensed.
 */

Module.register("MMM-MotionControl",{
	defaults: {
    delay: 5000,
    useFacialRecognitionOCV3: false
	},

  notificationReceived: function(notification, payload, sender) {
    if (this.config.useFacialRecognitionOCV3 === true) {
      this.handleFacialRecognitionOCV3(notification, payload, sender);
    }
  },

  handleFacialRecognitionOCV3: function(notification, payload, sender) {
    if (notification === 'CURRENT_USER') {
      Log.log(this.name + " received a module notification: " + notification + " with payload " + payload);

      if (payload === 'None') {
        setTimeout(function() {
          this.sendNotification('CECControl', 'off');
        }, this.config.delay);
      } else {
        this.sendNotification('CECControl', 'on');
      }
    }
  }
});