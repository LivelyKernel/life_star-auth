/*global require,process,setTimeout*/

var debug        = true;
var path         = require("path");
var util         = require("util");
var _            = require("underscore");
var UserDatabase = require("./auth").UserDatabase;

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
    logout: '/logout'
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
    <p><input type="text" name="username" value="" placeholder="Username"></p>\n\
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

LoginPage.tryLogin = function(authHandler, req, res) {
  var data = req.body;
  if (!data || (!data.password && !data.passwordHash)) return onFailure();

  var method = data.password ? 'checkPassword' : 'checkPasswordHash',
      payload = data.password || data.passwordHash;
  authHandler.userDB[method](data.name, payload, function(err, user) {
    if (err) res.status(500).end(String(err))
    else if (!user) onFailure();
    else onSuccess(user);
  });

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  function onSuccess(user) {
    authHandler.rememberUser(user, req);
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
      res.redirect(authHandler.config.paths.login + '?note=Login%20failed!');
    }
  }
}


var registerTemplate = _.template('\
<html>\n\
<head><title>Register an account</title></head>\n\
<body>\n\
  <h1>Register an account for Lively Web</h1>\n\
  <h2 style="display: none;" id="note"></h2>\n\
  <form method="post" action="{{ paths.register }}">\n\
    <input id="redirect" style="display: none;" type="text" name="redirect" value="">\n\
    <p><input type="text" name="username" value="" placeholder="Username"></p>\n\
    <p><input type="password" name="password" value="" placeholder="Password"></p>\n\
    <p><input type="group" name="group" value="" placeholder="Group"></p>\n\
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

LoginPage.tryRegister = function(authHandler, req, res) {
  var data = req.body;
  if (!data) {
    res.redirect(authHandler.config.paths.register + '?note=Registering failed!');
  } else {
    authHandler.userDB.register(data.username, data.group, data.email, data.password, function(err, user) {
      if (err || !user) res.redirect(authHandler.config.paths.register +  + '?note=' + String(err) || 'Registering failed!');
      else {
        authHandler.rememberUser(user, req);
        res.redirect(data.redirect || "/welcome.html");
      }
    });
  }
}

LoginPage.logout = function(authHandler, req, res) {
  req.session && (delete req.session[authHandler.config.cookieField]);
  res.end("Logged out");
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

  this.whenInitialized(function() {

    // e.g. login, let the http auth handler deal with the request
    var isAuthRequest = _.chain(paths).values().some(function(path) {
      return new RegExp("^" + path).test(req.path); }).value();
    if (isAuthRequest) { next(); return; }

    var authCookie = req.session && req.session[config.cookieField];
    var isOK = authCookie && authCookie.username === "robertkrahn";
    var db = this.userDB;

    db.findUserByCookie(authCookie, function(err, user) {
      if (err) res.status(500).end(String(err));
      else if (!isOK && !user) res.redirect(paths.login + '?redirect=' + encodeURIComponent(req.path));
      else {
        db.isRequestAllowed(authCookie, req, function(err, isAllowed) {
          if (err) {
            console.error("Error in hadnleRequest / isRequestAllowed: ", err);
            isAllowed = false;
          }
          if (!isAllowed) res.status(403).end();
          else next();
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

  var self = this;
  if (this._handlerFunc) {
    console.error("AuthHTTPHandler already registered!");
    return;
  }

  this.server = server;
  this.app = app;

  app.use(this._handlerFunc = function() { self.handleRequest.apply(self, arguments) });
  app.get(this.config.paths.login,     function(req, res, next) { LoginPage.renderLogin(self, req, res); });
  app.post(this.config.paths.login,    function(req, res, next) { LoginPage.tryLogin(self, req, res); });
  app.get(this.config.paths.register,  function(req, res, next) { LoginPage.renderRegister(self, req, res); });
  app.post(this.config.paths.register, function(req, res, next) { LoginPage.tryRegister(self, req, res); });
  app.all(this.config.paths.logout,    function(req, res, next) { LoginPage.logout(self, req, res); });

  UserDatabase.fromFile(this.config.usersFile, function(err, db) {
    if (err) console.error("Error in AuthHTTPHandler>>registerWith: ", err);
    self.userDB = db;
    console.log("AuthHTTPHandler>>registerWith now has UserDatabase");
    self.initialized = true;
  });

  return this;
}

HTTPHandler.prototype.whenInitialized = function(thenDo) {
  if (this.initialized) thenDo.call(this, null, this);
  else setTimeout(this.whenInitialized.bind(this, thenDo), 100);
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// exports
// -=-=-=-=-

module.exports = {
  HTTPHandler: HTTPHandler,
  LoginPage: LoginPage
};
