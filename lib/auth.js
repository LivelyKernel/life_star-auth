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
      thenDo("user file " + usersFile + " for auth DB does not exist!", {});
      return;
    }
    var data;
    fs.createReadStream(usersFile)
      .pipe(es.parse())
      .on("data", function(d) { data = d; })
      .on("end", function() { thenDo(null, data); })
      .on("error", function(err) {
        console.error("Cannot read auth file ", err);
        thenDo(err);
      });
  });
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

UserDatabase.fromFile = function(fileName, thenDo) {
  var db = new UserDatabase({storeChanges: true, userFile: fileName});
  db.once("error", function(err) { thenDo(err, db); });
  db.once("initialized", function(db) { thenDo(null, db); });
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
    thenDo(err, db);
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
  thenDo(null, {
    users: this.users,
    accessRules: this.accessRules.map(String)
  });
}

UserDatabase.prototype.storeUserFile = function(userFile, thenDo) {
  var db = this;
  if (db.locked) {
    return db.waitForUnlock(Date.now() + 1000, 'storeUserFile', function(err) {
      if (err) thenDo(err);
      else db.storeUserFile(userFile, thenDo);
    })
  }

  db.locked = true;
  async.waterfall([
    db.exportSettings.bind(db),
    function(exported, next) { 
      try { next(null, JSON.stringify(exported, null, 2)); } catch (e) { next(e); }
    },
    fs.writeFile.bind(fs, userFile)
  ], function(err) { db.locked = false; thenDo && thenDo(err); });
}

UserDatabase.prototype.register = function(userName, groupName, email, password, thenDo) {
  var db = this;
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
        db.storeUserFile(userFile, function(err) { next(null, user); });
      } else next(null, user);
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

UserDatabase.prototype.isRequestAllowed = function(sessionCookie, req, thenDo) {
  var db = this;
  async.waterfall([
    this.findUserByCookie.bind(this, sessionCookie),
    runRules.bind(null, db.accessRules),
    function(decision, next) {
      var isAllowed = decision === "allow";
      next(null, isAllowed);
    }
  ], function(err, isAllowed) {
    if (err) {
      console.error("Error in AuthDB>>isRequestAllowed: ", err);
      isAllowed = false;
    }
    thenDo(null, isAllowed);
  });

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  function runRules(rules, user, withResultDo) {
    if (!user || !rules || !rules.length) return withResultDo(null, "deny");
    var rule = rules[0];
    rule.call(null, user, req, function(err, decision) {
      if (err) { console.error("Error in AuthDB access rule %s:\n %s", rule, err); }
      else if (decision === "allow" || decision === "deny") withResultDo(null, decision);
      else runRules(rules.slice(1), user, withResultDo);
    });
    // FIXME timeout???
  }
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
