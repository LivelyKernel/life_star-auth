/*global module, console, setTimeout, __dirname*/

var helper    = require('./helper');
helper.linkLifeStarAuthModuleToLifeStar();

var path      = require("path"),
    async     = require('async'),
    util      = require('util'),
    fs        = require('fs'),
    testHelper   = require('life_star/tests/test-helper'),
    lifeStarTest = require("life_star/tests/life_star-test-support"),
    testSuite    = {},
    authConfFile = "test-user-db.json",
    serverConf   = {
      authConf: {
        enabled: true,
        cookieField: "test-auth-cookie",
        usersFile: authConfFile,
        paths: {
          login: '/test-login',
          register: '/test-register',
          logout: '/test-logout'
        }
      },
      fsNode: path.join(__dirname, "test-dir")
    };

testSuite.AuthHandlerRequests = {

  setUp: function(run) {
    lifeStarTest.createDirStructure(__dirname, {
      "test-dir": {"bar.js": "content 123", "foo.html": "<h1>hello world</h1>"}});
   helper.createUserAuthConf(authConfFile, {
   "users": [
      {"name": "user1", "group": "group1", "email": "user1@test", hash: "$2a$10$IfbfBnl486M2rTq3flpeg.MoU80gW0O7BceVvxZvWiWZLQpnr8.vS"},
      {"name": "user2", "group": "group2", "email": "user2@test", hash: "$2a$10$IfbfBnl486M2rTq3flpeg.oKsaDwPFMdyQRhOGCsmCazims1mOTNa"}]});
    run();
  },

  tearDown: function(run) {
    async.series([
      helper.cleanupAuthConfFile.bind(helper, authConfFile),
      lifeStarTest.cleanupTempFiles,
      lifeStarTest.shutDownLifeStar], run);
  },

  "unauthorized access redirects to login page": function(test) {
    lifeStarTest.withLifeStarDo(test, function() {
      lifeStarTest.GET('/foo.html', function(res) {
        test.equals(302, res.statusCode);
        test.equals('Moved Temporarily. Redirecting to /test-login?redirect=%252Ffoo.html', res.body);
        test.done();
      });
    }, serverConf);
  },

  "do login": function(test) {
    lifeStarTest.withLifeStarDo(test, function() {
      // first with wrong password
      async.series([
        function(next) {
          lifeStarTest.POST('/test-login',
            "username=user1&password=wrong+pwd", {"Content-Type": "application/x-www-form-urlencoded"},
            function(res) {
              test.equals('Moved Temporarily. Redirecting to /test-login?note=Login%2520failed!', res.body);
              test.deepEqual({}, helper.cookieFromResponse(res));
              next();
            });
        },
        // now with correct
        function(next) {
          lifeStarTest.POST('/test-login',
            "username=user1&password=foobar&redirect=%2Ffoo.html", {"Content-Type": "application/x-www-form-urlencoded"},
            function(res) {
              test.equals('Moved Temporarily. Redirecting to /foo.html', res.body);
              test.deepEqual({
                'test-auth-cookie': {
                  username: 'user1',
                  group: 'group1',
                  email: 'user1@test',
                  passwordHash: '$2a$10$IfbfBnl486M2rTq3flpeg.MoU80gW0O7BceVvxZvWiWZLQpnr8.vS'}},
                helper.cookieFromResponse(res));
              next();
            });
        }
      ], test.done);
    }, serverConf);
  },

  "test register user": function(test) {
    lifeStarTest.withLifeStarDo(test, function() {
      // first with wrong password
      async.series([
        function(next) {
          lifeStarTest.POST('/test-register',
            "username=user3&password=xxx", {"Content-Type": "application/x-www-form-urlencoded"},
            function(res) {
              test.equals('Moved Temporarily. Redirecting to /welcome.html', res.body);
              test.equals("user3", helper.cookieFromResponse(res)["test-auth-cookie"].username);
              next();
            });
        },
        function(next) {
          var fileContent = fs.readFileSync(authConfFile);
          var jso = JSON.parse(fileContent);
          test.equals("user3", jso.users.slice(-1)[0].name)
          next();
        },
        function(next) {
          lifeStarTest.POST('/test-login',
            "username=user3&password=xxx", {"Content-Type": "application/x-www-form-urlencoded"},
            function(res) {
              test.equals("user3", helper.cookieFromResponse(res)["test-auth-cookie"].username);
              next();
            });
        }
      ], test.done);
    }, serverConf);
  }

}


testSuite.AccessControlViaChains = {

  setUp: function(run) {
    lifeStarTest.createDirStructure(__dirname, {
      "test-dir": {
        "bar.js": "content 123",
        "foo.html": "<h1>hello world</h1>",
        "restricted-dir": {
          "page1.html": "<h1>foo</h1>",
          "page2.html": "<h1>barrrr</h1>"
        }
      }
    });
   helper.createUserAuthConf(authConfFile, {
   "users": [
      {"name": "user1", "group": "group1", "email": "user1@test", hash: "$2a$10$IfbfBnl486M2rTq3flpeg.MoU80gW0O7BceVvxZvWiWZLQpnr8.vS"},
      {"name": "user2", "group": "group2", "email": "user2@test", hash: "$2a$10$IfbfBnl486M2rTq3flpeg.oKsaDwPFMdyQRhOGCsmCazims1mOTNa"}],
    "accessRules": [
      function(user, req, callback) { callback(null, user.name === "user1" ? "allow" : null); },
      function(user, req, callback) { callback(null, !req.path.match(/\/restricted-dir\//) && req.method === "GET" ? "allow" : null); }]
    });
    run();
  },

  tearDown: function(run) {
    async.series([
      helper.cleanupAuthConfFile.bind(helper, authConfFile),
      lifeStarTest.cleanupTempFiles,
      lifeStarTest.shutDownLifeStar], run);
  },

  "authorized access": function(test) {
    lifeStarTest.withLifeStarDo(test, function() {
      lifeStarTest.GET('/foo.html', "",
        {"Cookie": helper.createAuthCookie({"test-auth-cookie": {"username":"user1", "passwordHash":"$2a$10$IfbfBnl486M2rTq3flpeg.MoU80gW0O7BceVvxZvWiWZLQpnr8.vS"}})},
        function(res) {
          test.equals(200, res.statusCode);
          test.equals('<h1>hello world</h1>', res.body);
          test.done();
        });
    }, serverConf);
  },

  "unauthorized GET": function(test) {
    lifeStarTest.withLifeStarDo(test, function() {
      lifeStarTest.GET('/restricted-dir/page1.html', "",
        {"Cookie": helper.createAuthCookie({"test-auth-cookie": {"username": "user2", "passwordHash": "$2a$10$IfbfBnl486M2rTq3flpeg.oKsaDwPFMdyQRhOGCsmCazims1mOTNa"}})},
        function(res) {
          test.equals(403, res.statusCode);
          test.done();
        });
    }, serverConf);
  },

  "unauthorized PUT": function(test) {
    lifeStarTest.withLifeStarDo(test, function() {
      lifeStarTest.PUT('/foo.html', "<bla bla bla/>",
        {"Cookie": helper.createAuthCookie({"test-auth-cookie": {"username": "user2", "passwordHash": "$2a$10$IfbfBnl486M2rTq3flpeg.oKsaDwPFMdyQRhOGCsmCazims1mOTNa"}})},
        function(res) {
          test.equals(403, res.statusCode);
          test.done();
        });
    }, serverConf);
  }

}

module.exports.testSuite = testSuite;
