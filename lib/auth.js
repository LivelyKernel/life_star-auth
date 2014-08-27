/*global require,process,setTimeout*/

var debug  = true;
var async  = require("async");
var fs     = require("fs");
var path   = require("path");
var es     = require("event-stream");
var bcrypt = require('bcrypt');
var events = require("events");
var util   = require("util");
var _      = require("underscore");

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// helper
// -=-=-=-

function readUsersFile(usersFile, thenDo) {
  var data;
  fs.createReadStream(usersFile)
      .pipe(es.parse())
      .on("data", function(d) { data = d; })
      .on("end", function() { thenDo(null, data); })
      .on("error", function(err) { thenDo(err); });
}

function watchUsersFile(usersFile, onChangeDo) {
  fs.watchFile(usersFile, {persistent: false, interval: 2002}, listener);
  return listener;

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  function listener(curr, prev) {
    debug && console.log("users file changed, reloading...");
    readUsersFile(usersFile, function(err, data) {
      debug && console.log("users file reloaded", err ? err : "");
      onChangeDo && onChangeDo(err, data);
    });
  }
}


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// UserDatabase
// -=-=-=-=-=-=-

function UserDatabase(config) {
  config = config || {};
  this.userFile = config.userFile;
  this.users = config.users || [];
  this.storeChanges = this.userFile && config.storeChanges;
  this.locked = false;
  this._fileWatcher = null;

  var self = this;
  if (this.userFile) {
    this.locked = true;
    this.initializeFromFile(
      this.userFile, function(err) {
        self.locked = false;
        self.emit(err ? "error" : "initialized", err || self); 
    });
  } else {
    setTimeout(function() { self.emit("initialized", self); }, 0);
  }
}

util.inherits(UserDatabase, events.EventEmitter);

UserDatabase.fromFile = function(fileName, thenDo) {
  var db = new UserDatabase({storeChanges: true, userFile: fileName});
  db.once("error", function(err) { thenDo(err); });
  db.once("initialized", function(db) { thenDo(null, db); });
};

UserDatabase.prototype.initializeFromFile = function(fileName, thenDo) {
  var self = this;

  this._fileWatcher = watchUsersFile(fileName, function(err, data) {
    data && (self.users = ensureUsers(data));
  });

  readUsersFile(fileName, function(err, data) {
    if (err || !data || !data.users) { thenDo(err, null); return; }
    self.users = ensureUsers(data);
    thenDo(err, self);
  });

  function ensureUsers(data) {
    return _.map(data.users, function(user) {
      return user instanceof User ? user : User.newFromFileEntry(user);
    });
  }
}

UserDatabase.prototype.close = function(thenDo) {
  (this._fileWatcher && this.userFile && fs.unwatchFile(this.userFile, this._fileWatcher));
  thenDo && thenDo(null);
}

UserDatabase.prototype.waitForUnlock = function(timeout, action, thenDo) {
  if (!this.locked) { thenDo(null); }
  else if (Date.now() > timeout) {
    thenDo(new Error("timeout waiting for unlock for action " + action));
  } else {
    setTimeout(this.waitForUnlock.bind(this, timeout, action, thenDo), 20);
  }
}

UserDatabase.prototype.storeUserFile = function(userFile, thenDo) {
  if (this.locked) {
    return this.waitForUnlock(Date.now() + 1000, 'storeUserFile', function(err) {
      if (err) thenDo(err);
      else this.storeUserFile(userFile, thenDo);
    }.bind(this))
  }

  try {
    this.locked = true;
    fs.writeFile(userFile, JSON.stringify({users: this.users}, null, 2), thenDo);
  } catch(e) { thenDo(e); } finally { this.locked = false; }
}

UserDatabase.prototype.register = function(userName, groupName, email, password, thenDo) {
  var db = this;

  if (db.locked) {
    return db.waitForUnlock(Date.now() + 1000, 'register', function(err) {
      if (err) thenDo(err);
      else db.register(userName, groupName, email, password, thenDo);
    })
  }

  async.waterfall([
    db.findUserByName.bind(db, userName),
    function(user, next) {
      next(user ? new Error("User " + userName + " already exists") : null);
    },
    function(next) {
      var user = User.newWithPlainPassword(userName, groupName, email, password)
      db.users.push(user);
      next(null, user);
    },
    function(user, next) {
      if (db.storeChanges) {
        var userFile = db.userFile;
        db.storeUserFile(userFile, function(err) {
          debug && console.log("user file %s stored ", userFile, err);
        });
      }
      next(null, user);
    }
  ], thenDo);

};

UserDatabase.prototype.findUserByName = function(userName, thenDo) {
  thenDo(null, _.find(this.users, function(ea) { return ea.name === userName; }));
}

UserDatabase.prototype.findUserByCookie = function(cookie, thenDo) {
  if (!cookie || !cookie.username) { thenDo(null, null); return; }
  this.findUserByName(cookie.username, function(err, user) {
    if (err || !user) { thenDo(err); return; }
    user.isIdentifiedByCookie(cookie, thenDo);
  });
}

UserDatabase.prototype.checkPassword = function(userName, password, thenDo) {
  this.findUserByName(userName, function(err, user) {
    if (err || !user) thenDo(err, null);
    else user.checkPassword(password, thenDo);
  });
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// User
// -=-=-

function User(name, group, email, passwordHash) {
  this.name = name;
  this.group = group;
  this.email = email;
  this.hash = passwordHash;
}

User.newFromFileEntry = function(fileEntry) {
  return User.newWithHashedPassword(
    fileEntry.name, fileEntry.group,
    fileEntry.email, fileEntry.hash);
}

User.newWithHashedPassword = function(name, group, email, passwordHash) {
  return new User(name, group, email, passwordHash);
}

User.newWithPlainPassword = function(name, group, email, password) {
  var user = new User(name, group, email, null);
  user.setPasswordHashed(password);
  return user;
};

User.prototype.isIdentifiedByCookie = function(cookie, thenDo) {
  var matches = cookie
   && cookie.username === this.name
   && cookie.passwordHash === this.hash;
   thenDo(null, matches ? this : null)
}

User.prototype.addToCookie = function(cookie, thenDo) {
  cookie.username = this.name;
  cookie.group = this.group;
  cookie.email = this.email;
  cookie.passwordHash = this.hash;
}

User.prototype.setPasswordHashed = function(password) {
  var salt = bcrypt.genSaltSync(10);
  this.hash = bcrypt.hashSync(password, salt);
}

User.prototype.checkPassword = function(password, callback) {
  var self = this;
  bcrypt.compare(password, this.hash, function(err, matches) {
    callback(err, matches ? self : null); });
}

User.prototype.isAllowed = function(req, callback) {
  callback(true);
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// exports
// -=-=-=-=-

module.exports = {
  UserDatabase: UserDatabase,
  User: User
};
