/*global require,process,setTimeout*/

var debug        = true;
var path         = require("path");
var util         = require("util");
var _            = require("underscore");
var UserDatabase = require("./auth").UserDatabase;

var defaultUsersFile = path.join(process.env.WORKSPACE_LK, "users.json");
// FIXME!
var cookieField = 'lvUserData_2013-10-12';

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

function HTTPHandler() {
  this.server = null;
  this.app = null;
  this.userDB = null;
}

HTTPHandler.prototype.handleRequest = function(req, res, next) {
  if (req.path.match(/^\/uvic-/)) { next(); return; }
  var isOK = req.session && req.session[cookieField] && req.session[cookieField].username === "robertkrahn";
  this.userDB.findUserByCookie(req.session[cookieField], function(err, user) {
    if (err) res.status(500).end(String(err));
    else if (!isOK && !user) res.redirect('/uvic-login?redirect=' + encodeURIComponent(req.path));
    else { next(); }
  });
}

HTTPHandler.prototype.rememberUser = function(user, req) {
  var cookie = req.session[cookieField] || (req.session[cookieField] = {});
  user && user.addToCookie(cookie);
}

HTTPHandler.prototype.registerWith = function(app, server) {
  var self = this;

  if (this._handlerFunc) {
    console.error("AuthHTTPHandler already registered!");
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
    if (err) { console.error("Error in AuthHTTPHandler>>registerWith: ", err); return; }
    self.userDB = db;
    console.log("AuthHTTPHandler>>registerWith now has UserDatabase");
  });
}


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// exports
// -=-=-=-=-

module.exports = {
  defaultUsersFile: defaultUsersFile,
  HTTPHandler: HTTPHandler,
  LoginPage: LoginPage
};
