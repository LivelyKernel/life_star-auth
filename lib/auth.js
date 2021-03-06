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
  fs.exists(usersFile, function(existing) {
    if (!existing) {
      thenDo && thenDo("user file " + usersFile + " for auth DB does not exist!", {});
      return;
    }
      fs.readFile(usersFile, function(err, content) {
        err && console.error("Cannot read auth file ", err);
    	  thenDo && thenDo(err, content);
      });
  });
}

function watchUsersFile(usersFile, onChangeDo) {
  fs.watchFile(usersFile, {persistent: false, interval: 2002}, listener);
  return listener;

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  function listener(curr, prev) {
    debug && console.log("users file changed, reloading...");
    createBackupOfUserDBFile(usersFile, function(err) {
      console.log("Stored backup for user file " + (err ? err : ""));
    });
    readUsersFile(usersFile, function(err, data) {
      debug && console.log("users file reloaded", err ? err : "");
      onChangeDo && onChangeDo(err, data);
    });
  }
}

function createBackupOfUserDBFile(usersFile, thenDo) {
  // save backup like users.json.1, users.json.2, ...
  var baseName = path.basename(usersFile);
  var dir = path.dirname(usersFile);
  async.waterfall([
      function(next) { fs.readdir(dir, next); },
      function(fileList, next) {
          var lastBackup = fileList
              .filter(function(ea) { return ea.match(/\.json\.[0-9]+$/); })
              .sort(function(a,b) { return parseInt(b.match(/[0-9]+$/)[0]) - parseInt(a.match(/[0-9]+$/)[0])})[0]

          var newBackup = lastBackup ?
              lastBackup.replace(/[0-9]+$/, function(match) { return (Number(match) || 0) + 1; }) :
              baseName + ".1";
          next(null, newBackup);
      },
      function(newBackup, next) {
          fs.readFile(usersFile, function(err, content) {
              next(err, newBackup, content); });
      },
      function(newBackup, content, next) {
          fs.writeFile(path.join(dir, newBackup), content, next);
      }
  ], thenDo);
}
 
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// UserDatabase
// -=-=-=-=-=-=-

function UserDatabase(config) {
  config = config || {};
  this.userFile = config.userFile;
  this.users = config.users || [];
  this.accessRules = config.accessRules || [];
  this.storeChanges = this.userFile && config.storeChanges;
  this.locked = false;
  this._fileWatcher = null;

  var db = this;
  if (db.userFile) {
    db.locked = true;
    db.initializeFromFile(
      db.userFile, function(err) {
        db.locked = false;
        db.emit(err ? "error" : "initialized", err || db); 
    });
  } else {
    setTimeout(function() { db.emit("initialized", db); }, 0);
  }
}

util.inherits(UserDatabase, events.EventEmitter);

// -=-=-=-=-=-=-
// persistence
// -=-=-=-=-=-=-
UserDatabase.fromFile = function(fileName, thenDo) {
  var db = new UserDatabase({storeChanges: true, userFile: fileName});
  db.once("error", function(err) { thenDo && thenDo(err, db); });
  db.once("initialized", function(db) { thenDo && thenDo(null, db); });
};

UserDatabase.prototype.initializeFromFile = function(fileName, thenDo) {
  var db = this;

  // 1. auto-update when file changes
  this._fileWatcher = watchUsersFile(fileName, function(err, data) {
    db.importSettings(data, false);
  });

  // 2. read file now
  async.waterfall([
    readUsersFile.bind(null, fileName),
    function(content, next) { db.importSettings(content, false, next); }
  ], function(err) {
    if (err) console.error("Error in initializeFromFile: ", err);
    thenDo && thenDo(err, db);
  });
}

UserDatabase.prototype.close = function(thenDo) {
  (this._fileWatcher && this.userFile && fs.unwatchFile(this.userFile, this._fileWatcher));
  thenDo && thenDo(null);
}

UserDatabase.prototype.waitForUnlock = function(timeout, action, thenDo) {
  debug && console.log("UserDatabase>>waitForUnlock (%s)", action);
  if (!this.locked) { thenDo(null); }
  else if (Date.now() > timeout) {
    thenDo(new Error("timeout waiting for unlock for action " + action));
  } else {
    setTimeout(this.waitForUnlock.bind(this, timeout, action, thenDo), 20);
  }
}

UserDatabase.prototype.importSettings = function(data, doSave, thenDo) {
  if (typeof doSave === 'function') { thenDo = doSave; doSave = true; }
  data = data || {};
  if (Buffer.isBuffer(data)) data = String(data);
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (e) {
      var err = new Error("importSettings parsing data: " + data);
      console.error("[life_start-auth] " + err);
      thenDo && thenDo(err);
      return;
    }
  }

  if (!data.users) {
    console.error("UserDatabase>>importSettings: broken data -- ",
      util.inspect(data, {depth: 1}));
  }

  var db = this;
  db.users = ensureUsers(data);
  db.accessRules = ensureAccessRules(data);
  if (doSave && db.storeChanges) {
    db.storeUserFile(db.userFile, thenDo);
  } else thenDo && thenDo(null);
  
  function ensureUsers(data) {
    return _.map(data.users, function(user) {
      return user instanceof User ? user : User.newFromFileEntry(user);
    });
  }

  function ensureAccessRules(data) {
    // create functions from source code
    return _.map(data.accessRules || [], function(ruleFuncSource) {
      return eval("(" + ruleFuncSource + ")");
    });
  }
}

UserDatabase.prototype.exportSettings = function(thenDo) {
  thenDo && thenDo(null, {
    users: this.users.map(function(ea) { return ea.export(); }),
    accessRules: this.accessRules.map(String)
  });
}

UserDatabase.prototype.storeUserFile = function(userFile, thenDo) {
  var db = this;
  if (db.locked) {
    return db.waitForUnlock(Date.now() + 1000, 'storeUserFile', function(err) {
      if (err) thenDo && thenDo(err);
      else db.storeUserFile(userFile, thenDo);
    })
  }

  db.locked = true;
  async.waterfall([
    function(next) {
      createBackupOfUserDBFile(userFile, function(err) {
        console.log("Stored backup for user file " + (err ? err : ""));
        next();
      });
    },
    db.exportSettings.bind(db),
    function(exported, next) { 
      try { next(null, JSON.stringify(exported, null, 2)); } catch (e) { next(e); }
    },
    fs.writeFile.bind(fs, userFile)
  ], function(err) { db.locked = false; thenDo && thenDo(err); });
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-
// interface for http handler
// -=-=-=-=-=-=-=-=-=-=-=-=-=-
UserDatabase.prototype.validateRegisterUserData = function(userData, thenDo) {
  var errors = [];
  try {
    if (!userData.name) errors.push("User needs a name");
    if (!userData.hash && !userData.password) errors.push("User needs a password");
    if (!userData.email) errors.push("No email");
    if (userData.email && !userData.email.match(/^[^@]+@[^@]+$/)) errors.push("Invalid email: " + userData.email);
  } catch (e) { return thenDo && thenDo(e); }
  thenDo && thenDo(!errors.length ? null : new Error(errors.join(', ')), userData);
}

UserDatabase.prototype.register = function(userData, thenDo) {
  var db = this, userName;
  async.waterfall([
    db.validateRegisterUserData.bind(db, userData),
    function(userData, next) { next(null, userData.name) },
    db.findUserByName.bind(db),
    function(user, next) {
      next(user ? new Error("User " + user.name + " already exists") : null);
    },
    function(next) {
      var user = User.newWithPlainPassword(userData)
      db.users.push(user);
      next(null, user);
    },
    function(user, next) {
      if (db.storeChanges) {
        var userFile = db.userFile;
        db.storeUserFile(userFile, function(err) { next(null, user); });
      } else next(null, user);
    }
  ], thenDo);
};

UserDatabase.prototype.findUserByName = function(userName, thenDo) {
  thenDo && thenDo(null, _.find(this.users, function(ea) { return ea.name === userName; }));
}

UserDatabase.prototype.findUserByCookie = function(cookie, thenDo) {
  if (!cookie || !cookie.username) { thenDo && thenDo(null, null); return; }
  this.findUserByName(cookie.username, function(err, user) {
    if (err || !user) { thenDo && thenDo(err); return; }
    user.isIdentifiedByCookie(cookie, thenDo && thenDo);
  });
}

UserDatabase.prototype.checkPasswordHash = function(userName, passwordHash, thenDo) {
  this.findUserByName(userName, function(err, user) {
    if (err || !user) thenDo && thenDo(err, null);
    else user.checkPasswordHash(passwordHash, thenDo);
  });
}

UserDatabase.prototype.checkPassword = function(userName, password, thenDo) {
  this.findUserByName(userName, function(err, user) {
    if (err || !user) thenDo && thenDo(err, null);
    else user.checkPassword(password, thenDo);
  });
}

UserDatabase.prototype.isRequestAllowed = function(sessionCookie, req, thenDo) {
  var db = this;
  async.waterfall([
    this.findUserByCookie.bind(this, sessionCookie),
    runRules.bind(null, db.accessRules),
    _.once(function(decision, next) {
      var isAllowed = decision === "allow";
      next(null, isAllowed);
    })
  ], function(err, isAllowed) {
    if (err) {
      console.error("Error in AuthDB>>isRequestAllowed: ", err);
      isAllowed = false;
    }
    thenDo && thenDo(null, isAllowed);
  });

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  function runRules(rules, user, withResultDo) {
    if (!rules || !rules.length) return withResultDo(null, "deny");
    var rule = rules[0];

    var timeoutMs = 1000, answered = false;
    var timeout = setTimeout(function() {
      if (answered) return; answered = true;
      console.error("access rule " + rule + " timed out");
      withResultDo(null, "undecided");
    }, timeoutMs);

    try {
      rule.call(null, db, user, req, function(err, decision) {
        if (answered) return; answered = true;
        clearTimeout(timeout);
        if (err) handleError(err);
        else if (decision === "allow" || decision === "deny") withResultDo(null, decision);
        else runRules(rules.slice(1), user, withResultDo);
      });
    } catch(err) { handleError(err); }
    
    function handleError(err) {
       console.error("Error in AuthDB access rule %s:\n %s", rule, err);
       withResultDo(null, "deny")
    }
  }
}

// -=-=-=-=-=-
// nodejs API
// -=-=-=-=-=-
UserDatabase.prototype.modifySettings = function(modifyAction, thenDo) {
  var db = this;
  async.waterfall([
    db.exportSettings.bind(db),
    function(settings, next) {
      var newSettings = modifyAction(settings);
      db.importSettings(newSettings, true, next);
    }
  ], thenDo);
}

UserDatabase.prototype.addUser = function(user, thenDo) {
  if (!user.name) return thenDo && thenDo(new Error("Invalid user " + util.inspect(user, {depth: 1})));
  this.modifySettings(function(data) {
    var found = _.find(data.users, function(_user, i) { return _user.name === user.name; });
    if (found) data.users[data.users.indexOf(found)] = user;
    else data.users.push(user);
    return data;
  }, thenDo);
}

UserDatabase.prototype.removeUserNamed = function(userName, thenDo) {
  this.modifySettings(function(data) {
    data.users = data.users.filter(function(user) { return user.name !== userName; });
    return data; }, thenDo);
}

UserDatabase.prototype.getAccessRules = function(thenDo) {
  this.exportSettings(function(err, settings) {
    thenDo && thenDo(err, settings.accessRules); });
}

UserDatabase.prototype.setAccessRules = function(rules, thenDo) {
  if (!_.isArray(rules)) return thenDo && thenDo(new Error("rules not an array"));
  if (!_.every(rules, function(ea) { return typeof ea === 'string'; })) return thenDo && thenDo(new Error("rules not stringified"));
  if (!_.every(rules, function(ea) { try { return typeof eval('(' + ea  + ')') === 'function' } catch (e) { return false; } })) return thenDo && thenDo(new Error("rules not valid stringified functions"));
  this.modifySettings(function(data) { data.accessRules = rules; return data; }, thenDo);
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// User
// -=-=-

function User(name, email, passwordHash, customFields) {
  this.name = name;
  this.email = email;
  this.hash = passwordHash;
  this.custom = customFields;
}

User.newFromData = function(userData) {
  var name = userData.name;
  var email = userData.email;
  var hash = userData.hash;
  var customFields = _.chain(userData).keys()
    .without('name', 'email', 'password', 'hash', 'custom').reduce(function(custom, key) {
      custom[key] = userData[key]; return custom; }, {}).value();
  if (userData.custom) _.keys(userData.custom).forEach(function(key) {
    customFields[key] = userData.custom[key] });
  var user = new User(name, email, hash, customFields);
  if (!hash && userData.password) user.setPasswordHashed(userData.password);
  return user;
}

User.newFromFileEntry = function(fileEntry) {
  return User.newFromData(fileEntry);
}

User.newWithHashedPassword = function(userData) {
  return User.newFromData(userData);
}

User.newWithPlainPassword = function(userData) {
  return User.newFromData(userData);
};

User.prototype.isIdentifiedByCookie = function(cookie, thenDo) {
  var matches = cookie
   && cookie.username === this.name
   && cookie.passwordHash === this.hash;
   thenDo && thenDo(null, matches ? this : null)
}

User.prototype.addToCookie = function(cookie, thenDo) {
  cookie.username = this.name;
  cookie.group = this.group;
  cookie.email = this.email;
  cookie.passwordHash = this.hash;
}

User.prototype.hashPassword = function(password) {
  return bcrypt.hashSync(password, bcrypt.genSaltSync(10));
}

User.prototype.setPasswordHashed = function(password) {
  this.hash = this.hashPassword(password);
}

User.prototype.checkPasswordHash = function(passwordHash, callback) {
  callback(null, passwordHash === this.hash ? this : null);
}

User.prototype.checkPassword = function(password, callback) {
  var self = this;
  bcrypt.compare(password, this.hash, function(err, matches) {
    callback(err, matches ? self : null); });
}

User.prototype.isAllowed = function(req, callback) {
  callback(true);
}

User.prototype.export = function() {
  return JSON.parse(JSON.stringify(this));
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// exports
// -=-=-=-=-

module.exports = {
  UserDatabase: UserDatabase,
  User: User
};
