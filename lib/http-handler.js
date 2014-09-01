/*global require,process,setTimeout*/

var debug        = true;
var path         = require("path");
var async        = require("async");
var util         = require("util");
var _            = require("underscore");
var UserDatabase = require("./auth").UserDatabase;

// mustache-style templates
_.templateSettings = {
  interpolate: /\{\{(.+?)\}\}/g
};

var defaultConf = {
  enabled: false,
  cookieField: "lively-auth-cookie",
  usersFile: path.join(process.cwd(), "users.json"),
  paths: {
    login: '/login',
    register: '/register',
    logout: '/logout',
    currentUser: '/current-user',
    checkPassword: '/check-password',
    userExists: '/users-exists',
    listUsers: '/list-users'
  }
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

var loginTemplate = _.template(
'<html>\n\
<head><title>Login to Lively Web</title></head>\n\
<body>\n\
  <h1>Login to Lively Web</h1>\n\
  <h2 style="display: none;" id="note"></h2>\n\
  <form method="post" action="{{ paths.login }}">\n\
    <input id="redirect" style="display: none;" type="text" name="redirect" value="">\n\
    <p><input type="text" name="name" value="" placeholder="Username"></p>\n\
    <p><input type="password" name="password" value="" placeholder="Password"></p>\n\
    <p class="submit"><input type="submit" name="action" value="Login"></p>\n\
  </form>\n\
<p>If you don\'t have a username/password yet \n\
<a href="{{ paths.register }}">please click here</a>.\n\
<script>({{ js  }})();</script>\n\
<p><b>The login system is currently being tested.</b><br>\n\
You can login with the username/password test-user/1234.\n\
</body>\n\
</html>');

LoginPage.renderLogin = function(authHandler, req, res) {
  res.end(loginTemplate({
    js: String(LoginPage.clientJS),
    paths: authHandler.config.paths
  }));
}

var registerTemplate = _.template('\
<html>\n\
<head><title>Register an account</title></head>\n\
<body>\n\
  <h1>Register an account for Lively Web</h1>\n\
  <h2 style="display: none;" id="note"></h2>\n\
  <form method="post" action="{{ paths.register }}">\n\
    <input id="redirect" style="display: none;" type="text" name="redirect" value="">\n\
    <p><input type="text" name="name" value="" placeholder="Username"></p>\n\
    <p><input type="password" name="password" value="" placeholder="Password"></p>\n\
    <p><input type="text" name="group" value="" placeholder="Group"></p>\n\
    <p><input type="email" name="email" value="" placeholder="E-Mail"></p>\n\
    <p class="submit"><input type="submit" name="action" value="Register"></p>\n\
  </form>\n\
<script>({{ js }})();</script></body>\n\
</html>');

LoginPage.renderRegister = function(authHandler, req, res) {
  res.end(registerTemplate({
    js: String(LoginPage.clientJS),
    paths: authHandler.config.paths
  }));
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// HTTP request handler / express app adapter
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

function HTTPHandler(config) {
  this.config = util._extend({}, util._extend(defaultConf, config || {}));
  this.initialized = false;
  this.server = null;
  this.app = null;
  this.userDB = null;
}

HTTPHandler.prototype.handleRequest = function(req, res, next) {
  var config = this.config, paths = this.config.paths;

  req.__defineGetter__("livelySession", function() {
    var authCookie = req.session && req.session[config.cookieField];
    return authCookie || {};
  });

  this.whenInitialized(function() {

    // e.g. login, let the http auth handler deal with the request
    var isAuthRequest = _.chain(paths).values().some(function(path) {
      return new RegExp("^" + path).test(req.path); }).value();
    if (isAuthRequest) { next(); return; }

    var isOK = req.livelySession.username === "robertkrahn";
    var db = this.userDB;

    db.findUserByCookie(req.livelySession, function(err, user) {
      if (err) res.status(500).end(String(err));
      else if (!isOK && !user) res.redirect(paths.login + '?redirect=' + encodeURIComponent(req.path));
      else {
        db.isRequestAllowed(req.livelySession, req, function(err, isAllowed) {
          if (err) {
            console.error("Error in hadnleRequest / isRequestAllowed: ", err);
            isAllowed = false;
          }

          if (isAllowed) next()
    	    else res.status(403)
       		    .end("<h1>Forbidden</h1><p>HTTP "
          			 + req.method + " to "
          			 + req.path + " not allowed</p>");
        })
      }
    });
  });
}

HTTPHandler.prototype.rememberUser = function(user, req) {
  var cookie = req.session[this.config.cookieField] || (req.session[this.config.cookieField] = {});
  user && user.addToCookie(cookie);
}

HTTPHandler.prototype.registerWith = function(app, server) {
  if (!this.config.enabled) { this.initialized = true; return; }

  var handler = this;
  if (this._handlerFunc) {
    console.error("AuthHTTPHandler already registered!");
    return;
  }

  this.server = server;
  this.app = app;

  app.use(this._handlerFunc = function() { handler.handleRequest.apply(handler, arguments) });
  app.get(this.config.paths.login,          LoginPage.renderLogin.bind(LoginPage, handler));
  app.post(this.config.paths.login,         handler.tryLogin.bind(handler));
  app.get(this.config.paths.register,       LoginPage.renderRegister.bind(LoginPage, handler));
  app.post(this.config.paths.register,      handler.tryRegister.bind(handler));
  app.all(this.config.paths.logout,         handler.logout.bind(handler));
  app.get(this.config.paths.currentUser,    handler.renderCurrentUserInfo.bind(handler));
  app.post(this.config.paths.currentUser,   handler.modifyCurrentUserInfo.bind(handler));
  app.post(this.config.paths.checkPassword, handler.checkPassword.bind(handler));
  app.post(this.config.paths.userExists,    handler.userExists.bind(handler));
  app.get(this.config.paths.listUsers,      handler.listUsers.bind(handler));

  UserDatabase.fromFile(this.config.usersFile, function(err, db) {
    if (err) console.error("Error in AuthHTTPHandler>>registerWith: ", err);
    handler.userDB = db;
    console.log("AuthHTTPHandler>>registerWith now has UserDatabase");
    handler.initialized = true;
  });

  return this;
}

HTTPHandler.prototype.whenInitialized = function(thenDo) {
  if (this.initialized) thenDo.call(this, null, this);
  else setTimeout(this.whenInitialized.bind(this, thenDo), 100);
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

HTTPHandler.prototype.tryLogin = function(req, res) {
  var self = this;
  var data = req.body;
  if (!data || (!data.password && !data.passwordHash)) return onFailure();

  var method = data.password ? 'checkPassword' : 'checkPasswordHash',
      payload = data.password || data.passwordHash;
  this.userDB[method](data.name, payload, function(err, user) {
    if (err) res.status(500).end(String(err))
    else if (!user) onFailure();
    else onSuccess(user);
  });

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  function onSuccess(user) {
    self.rememberUser(user, req);
    if (req.is("application/json")) {
      res.json(user.export());
    } else {
      res.redirect(data.redirect || "/welcome.html");
    }
  }

  function onFailure() {
    if (req.is("application/json")) {
      res.status(401).json({status: "login failed"});
    } else {
      res.redirect(self.config.paths.login + '?note=Login%20failed!');
    }
  }
}
HTTPHandler.prototype.tryRegister = function(req, res) {
  var self = this, data = req.body;
  if (!data) {
    res.redirect(self.config.paths.register + '?note=Registering failed, no user data received!');
  } else {
    self.userDB.register(data, function(err, user) {
      if (err || !user) res.redirect(
          self.config.paths.register + '?note=' + (String(err) || 'Registering failed!'));
      else {
        self.rememberUser(user, req);
        res.redirect(data.redirect || "/welcome.html");
      }
    });
  }
}

HTTPHandler.prototype.logout = function(req, res) {
  req.session && (delete req.session[this.config.cookieField]);
  res.end("Logged out");
}

HTTPHandler.prototype.renderCurrentUserInfo = function(req, res) {
  var authCookie = req.session && req.session[this.config.cookieField];
  if (!authCookie) return res.json({error: "not logged in"});

  this.userDB.findUserByCookie(authCookie, function(err, user) {
    res.json(err || !user ?
      {error: err ? String(err) : "not logged in"} :
      user.export());
  });
}

HTTPHandler.prototype.modifyCurrentUserInfo = function(req, res) {
  var self = this
  var authCookie = req.session && req.session[self.config.cookieField];
  var userData = req.body;
  var db = self.userDB;

  if (!userData) return res.status(400).json({error: "received no data"});
  if (!authCookie) return res.status(403).json({error: "not allowed"});

  async.waterfall([
    db.findUserByCookie.bind(db, authCookie),
    function(user, next) {
      if (userData.password) {
        userData.hash = user.hashPassword(userData.password);
        delete userData.password;
      }
      next(null, util._extend(user.export(), userData)); },
    db.validateRegisterUserData.bind(db),
    db.addUser.bind(db),
    db.findUserByName.bind(db, authCookie.username),
  ], function(err, updatedUser) {
      if (err || !updatedUser) return res.status(400).json({error: err ? String(err) : "Could not update user " + authCookie.username});
      else{
        self.rememberUser(updatedUser, req);
        res.json(updatedUser.export());
      }
  });
}

HTTPHandler.prototype.checkPassword = function(req, res) {
  var authCookie = req.session && req.session[this.config.cookieField],
      userData = req.body,
      userName = userData.name || authCookie.username,
      password = userData.password,
      db = this.userDB;

  if (!userName) return res.status(400).json({error: "no user name"});
  if (!password) return res.status(400).json({error: "no password"});

  db.checkPassword(userName, password, function(err, user) {
    if (err) res.status(500).end(String(err))
    else if (!user) res.status(401).json({status: "password incorrect"})
    else res.json({status: "password matches"})
  });
}

HTTPHandler.prototype.userExists = function(req, res) {
  var authCookie = req.session && req.session[this.config.cookieField],
      userData = req.body,
      userName = userData.name,
      db = this.userDB;

  if (!userName) return res.status(400).json({error: "no user name"});

  var user = _.find(db.users, function(user) { return user.name === userName; });
  res.json(user ? user.export() : {error: "not found"});
}

HTTPHandler.prototype.listUsers = function(req, res) {
  var authCookie = req.session && req.session[this.config.cookieField],
      db = this.userDB;
  res.json(db.users.map(function(user) { return user.export(); }));
}


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// exports
// -=-=-=-=-

module.exports = {
  HTTPHandler: HTTPHandler,
  LoginPage: LoginPage
};
