/* Magic Mirror
 * Module: MMM-MotionControl
 *
 * By Thierry Nischelwitzer http://nischi.ch
 * MIT Licensed.
 */

Module.register("MMM-MotionControl",{
	defaults: {
    delay: 15000,
    interval: 5000,
    useFacialRecognitionOCV3: false,
    useMMMFaceRecoDNN: false
  },

  timeout: null,

  notificationReceived: function(notification, payload, sender) {
    var self = this;

    if (this.config.useFacialRecognitionOCV3 === true) {
      this.handleFacialRecognitionOCV3(notification, payload, sender);
    }
    if (this.config.useMMMFaceRecoDNN === true) {
      setInterval(function() {
        self.sendNotification("GET_LOGGED_IN_USERS");
      }, this.config.interval);
      this.handleFaceRecoDNN(notification, payload, sender);
    }
  },

  handleFacialRecognitionOCV3: function(notification, payload, sender) {
    var _self = this;
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
  },

  handleFaceRecoDNN: function(notification, payload, sender) {
    var _self = this;
    if (notification === 'LOGGED_IN_USERS') {
      Log.log(this.name + " received a module notification: " + notification + " with payload " + payload);

      if (payload.length === 0) {
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