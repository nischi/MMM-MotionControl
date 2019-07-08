/* Magic Mirror
 * Module: MMM-MotionControl
 *
 * By Thierry Nischelwitzer http://nischi.ch
 * MIT Licensed.
 */

require('moment');

Module.register("MMM-MotionControl",{
	defaults: {
    delay: 15000,
    interval: 5000,
    useFacialRecognitionOCV3: false,
    useMMMFaceRecoDNN: false,
    ontime: []
  },

  timeout: null,

	start: function() {
    var self = this;

    if (this.config.useMMMFaceRecoDNN === true) {
      setInterval(function() {
        self.sendNotification("GET_LOGGED_IN_USERS");
      }, this.config.interval);
    }
  },

  inOnTime: function() {
    var inOnTime = false;
    var today = moment().startOf('day');
    this.config.ontime.forEach(time => {
      var split = time.split('-');
      var from = today.add(split[0].substr(0, 2), 'h').add(split[0].substr(2, 2), 'm');
      var to = today.add(split[1].substr(0, 2), 'h').add(split[1].substr(2, 2), 'm');

      if (moment().isBetween(from, to)) {
        inOnTime = true;
      }
    });

    return inOnTime;
  },

  notificationReceived: function(notification, payload, sender) {
    if (this.inOnTime()) {
      _self.sendNotification('CECControl', 'on');
    } else {
      if (this.config.useFacialRecognitionOCV3 === true) {
        this.handleFacialRecognitionOCV3(notification, payload, sender);
      }
      if (this.config.useMMMFaceRecoDNN === true) {
        this.handleFaceRecoDNN(notification, payload, sender);
      }
    }
  },

  handleFacialRecognitionOCV3: function(notification, payload, sender) {
    var _self = this;
    if (notification === 'CURRENT_USER') {
      Log.log(this.name + " received a module notification: " + notification + " with payload " + payload);

      if (payload === 'None') {
        _self.timeout = setTimeout(function() {
          _self.sendNotification('CECControl', 'off');
        }, this.config.delay);
      } else {
        clearTimeout(_self.timeout);
        _self.sendNotification('CECControl', 'on');
      }
    }
  },

  handleFaceRecoDNN: function(notification, payload, sender) {
    var _self = this;
    if (notification === 'LOGGED_IN_USERS') {
      Log.log(this.name + " received a module notification: " + notification + " with payload " + payload.length);

      if (payload.length === 0) {
        _self.timeout = setTimeout(function() {
          _self.sendNotification('CECControl', 'off');
        }, this.config.delay);
      } else {
        clearTimeout(_self.timeout);
        _self.sendNotification('CECControl', 'on');
      }
    }
  }
});