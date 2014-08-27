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

var defaultUsersFile = path.join(process.env.WORKSPACE_LK, "users.json");
// FIXME!
var cookieField = 'lvUserData_2013-10-12';


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

UserDatabase.prototype.findUserBySession = function(session, thenDo) {
  var cookie = session[cookieField];
  if (!cookie || !cookie.username) { thenDo(null, null); return; }
  this.findUserByName(cookie.username, function(err, user) {
    if (err || !user) { thenDo(err); return; }
    user.isIdentifiedBySession(session, thenDo);
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

User.prototype.isIdentifiedBySession = function(session, thenDo) {
  var cookie = session && session[cookieField];
  var matches = cookie
   && cookie.username === this.name
   && cookie.passwordHash === this.hash;
   thenDo(null, matches ? this : null)
}

User.prototype.addToSession = function(session, thenDo) {
  var cookie = session[cookieField] || (session[cookieField] = {});
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
// HTML Login doc
// -=-=-=-=-=-=-=-

var LoginPage = {};

LoginPage.clientJS = function() {
  var noteMatch = document.location.search.match(/note=([^\&]+)/);
  var note = noteMatch && noteMatch[1];
  if (note) {
    var el = document.getElementById("note");
    el.style.display = 'inherit';
    el.textContent = decodeURIComponent(note);
  }
  var redirectMatch = document.location.search.match(/redirect=([^\&]+)/);
  var redirect = redirectMatch && redirectMatch[1];
  if (redirect) {
    var el = document.getElementById("redirect");
    el.value = decodeURIComponent(redirect);
  }
}

LoginPage.renderLogin = function(authHandler, req, res) {
  var html = "<html>\n"
           + "<head><title>Login to Lively Web</title></head>\n"
           + "<body>\n"
           + "  <h1>Login to Lively Web</h1>\n"
           + "  <h2 style=\"display: none;\" id=\"note\"></h2>\n"
           + "  <form method=\"post\" action=\"/uvic-login\">\n"
           + "    <input id=\"redirect\" style=\"display: none;\" type=\"text\" name=\"redirect\" value=\"\">\n"
           + "    <p><input type=\"text\" name=\"username\" value=\"\" placeholder=\"Username\"></p>\n"
           + "    <p><input type=\"password\" name=\"password\" value=\"\" placeholder=\"Password\"></p>\n"
           + "    <p class=\"submit\"><input type=\"submit\" name=\"action\" value=\"Login\"></p>\n"
           + "  </form>\n"
           + "<p>If you don't have a username/password yet <a href=\"/uvic-register\">please click here</a>."
           + "<script>(" + LoginPage.clientJS + ")();</script>"
           + "<p><b>The login system is currently being tested.</b><br>You can login with the username/password test-user/1234."
           + "</body>\n"
           + "</html>\n";
  res.end(html);
}

LoginPage.tryLogin = function(authHandler, req, res) {
  var data = req.body;
  if (!data) {
    res.redirect('/uvic-login?note=Login failed!');
  } else {
    authHandler.userDB.checkPassword(data.username, data.password, function(err, user) {
      if (err) res.status(500).end(String(err))
      else if (!user) res.redirect('/uvic-login?note=Login%20failed!');  
      else {
        authHandler.rememberUser(user, req);
        res.redirect(data.redirect || "/welcome.html");
      }
    });
  }
}

LoginPage.renderRegister = function(authHandler, req, res) {
  var html = "<html>\n"
           + "<head><title>Register an account</title></head>\n"
           + "<body>\n"
           + "  <h1>Register an account for Lively Web</h1>\n"
           + "  <h2 style=\"display: none;\" id=\"note\"></h2>\n"
           + "  <form method=\"post\" action=\"/uvic-register\">\n"
           + "    <input id=\"redirect\" style=\"display: none;\" type=\"text\" name=\"redirect\" value=\"\">\n"
           + "    <p><input type=\"text\" name=\"username\" value=\"\" placeholder=\"Username\"></p>\n"
           + "    <p><input type=\"password\" name=\"password\" value=\"\" placeholder=\"Password\"></p>\n"
           + "    <p><input type=\"group\" name=\"group\" value=\"\" placeholder=\"Group\"></p>\n"
           + "    <p><input type=\"email\" name=\"email\" value=\"\" placeholder=\"E-Mail\"></p>\n"
           + "    <p class=\"submit\"><input type=\"submit\" name=\"action\" value=\"Register\"></p>\n"
           + "  </form>\n"
           + "<script>(" + LoginPage.clientJS + ")();</script>"
           + "</body>\n"
           + "</html>\n";
  res.end(html);
}

LoginPage.tryRegister = function(authHandler, req, res) {
  var data = req.body;
  if (!data) {
    res.redirect('/uvic-register?note=Registering failed!');
  } else {
    authHandler.userDB.register(data.username, data.group, data.email, data.password, function(err, user) {
      if (err || !user) res.redirect('/uvic-register?note=' + String(err) || 'Registering failed!');  
      else {
        authHandler.rememberUser(user, req);
        res.redirect(data.redirect || "/welcome.html");
      }
    });
  }
}

LoginPage.logout = function(authHandler, req, res) {
  req.session && (delete req.session[cookieField]);
  res.end("Logged out");
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// HTTP request handler / express app adapter
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

function CourseAuthHandler() {
  this.server = null;
  this.app = null;
  this.userDB = null;
}

CourseAuthHandler.prototype.handleRequest = function(req, res, next) {
  if (req.path.match(/^\/uvic-/)) { next(); return; }
  var isOK = req.session && req.session[cookieField] && req.session[cookieField].username === "robertkrahn";
  this.userDB.findUserBySession(req.session, function(err, user) {
    if (err) res.status(500).end(String(err));
    else if (!isOK && !user) res.redirect('/uvic-login?redirect=' + encodeURIComponent(req.path));
    else { next(); }
  });
}

CourseAuthHandler.prototype.rememberUser = function(user, req) {
  user && user.addToSession(req.session);
}

CourseAuthHandler.prototype.registerWith = function(app, server) {
  var self = this;

  if (this._handlerFunc) {
    console.error("CourseAuthHandler already registered!");
    return;
  }

  this.server = server;
  this.app = app;

  app.use(this._handlerFunc = function() { self.handleRequest.apply(self, arguments) });

  app.get("/uvic-login", function(req, res, next) { LoginPage.renderLogin(self, req, res); });
  app.post("/uvic-login", function(req, res, next) { LoginPage.tryLogin(self, req, res); });
  app.get("/uvic-register", function(req, res, next) { LoginPage.renderRegister(self, req, res); });
  app.post("/uvic-register", function(req, res, next) { LoginPage.tryRegister(self, req, res); });
  app.all("/uvic-logout", function(req, res, next) { LoginPage.logout(self, req, res); });


  UserDatabase.fromFile(defaultUsersFile, function(err, db) {
    if (err) { console.error("Error in CourseAuthHandler>>registerWith: ", err); return; }
    self.userDB = db;
    console.log("CourseAuthHandler>>registerWith now has UserDatabase");
  });
}


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// exports
// -=-=-=-=-

module.exports = {
  defaultUsersFile: defaultUsersFile,
  CourseAuthHandler: CourseAuthHandler,
  LoginPage: LoginPage,
  UserDatabase: UserDatabase,
  User: User
};
