/*global module, console, setTimeout*/

// continously run with:
// nodemon nodeunit tests/auth-test.js

var async = require('async'),
    util  = require('util'),
    auth  = require('../lib/auth'),
    fs    = require('fs'),
    _     = require("underscore"),
    testSuite = {};

var authConfFile = "test-user-db.json";
function createUserAuthConf(data) {
  var toWrite = util._extend({}, data);
  toWrite.accessRules && (toWrite.accessRules = toWrite.accessRules.map(String));
  fs.writeFileSync(authConfFile, JSON.stringify(toWrite));
  return data;
}
function cleanupAuthConfFile(thenDo) {
  fs.unwatchFile(authConfFile);
  if (fs.existsSync(authConfFile))
    fs.unlinkSync(authConfFile);
  thenDo && thenDo();
}

testSuite.UserDatabaseTest = {

  tearDown: function(run) {
    cleanupAuthConfFile(run);
  },

  "simple register user": function(test) {
    var db = new auth.UserDatabase();
    test.equals(0, db.users.length);
    db.register("foo", "foos group", "foo@bar", "geheim", function(err, user) {
      test.ok(!err, "error? " + err);
      test.equals(1, db.users.length);
      test.deepEqual([{name: "foo", group: "foos group", email: "foo@bar", hash: user.hash}], db.users);
      test.done();
    });
  },

  "read and write user db": function(test) {
    createUserAuthConf({"users": [
      {"name": "xx", "group": "yy", "email": "x@y", hash: "$2a$10$IfbfBnl486M2rTq3flpeg.MoU80gW0O7BceVvxZvWiWZLQpnr8.vS"},
      {"name": "ab", "group": "de", "email": "a@b", hash: "$2a$10$IfbfBnl486M2rTq3flpeg.oKsaDwPFMdyQRhOGCsmCazims1mOTNa"}]});
    async.waterfall([
      function(next) { auth.UserDatabase.fromFile("test-user-db.json", next); },
      function(db, next) {
        test.equals(2, db.users.length);
        db.checkPassword("xx", "foobar", function(err, matches) { next(err, db, matches); });
      },
      function(db, matches, next) { test.ok(matches); next(null, db); },
      function(db, next) { db.register("new-user", "grp", "a@c", "123", next); },
      function(user, next) {
        fs.readFile("test-user-db.json", function(err, content) { next(err, user, String(content)); }); },
      function(user, fileContent, next) {
        var jso = JSON.parse(fileContent);
        var storedUser = _.find(jso.users, function(ea) { return ea.name === "new-user"; });
        test.ok(storedUser, "no user found");
        test.deepEqual(user, storedUser);
        next();
      }
    ], test.done);
  },

  "dont register user twice": function(test) {
    createUserAuthConf({"users": [
      {"name": "xx", "group": "yy", "email": "x@y", hash: "$2a$10$IfbfBnl486M2rTq3flpeg.MoU80gW0O7BceVvxZvWiWZLQpnr8.vS"},
      {"name": "ab", "group": "de", "email": "a@b", hash: "$2a$10$IfbfBnl486M2rTq3flpeg.oKsaDwPFMdyQRhOGCsmCazims1mOTNa"}]});
    async.waterfall([
      function(next) { auth.UserDatabase.fromFile("test-user-db.json", next); },
      function(db, next) { db.register("xx", "grp", "a@c", "123", function(err, user) { next(null, err, user); }); },
      function(err, user, next) {
        test.ok(err && String(err).match(/User xx already exists/i), String(err));
        test.ok(!user, "user created?");
        next();
      },
    ], test.done);
  },

  "file changes affect DB": function(test) {
    var data = createUserAuthConf({"users": [
      {"name": "xx", "group": "yy", "email": "x@y", hash: "$2a$10$IfbfBnl486M2rTq3flpeg.MoU80gW0O7BceVvxZvWiWZLQpnr8.vS"},
      {"name": "ab", "group": "de", "email": "a@b", hash: "$2a$10$IfbfBnl486M2rTq3flpeg.oKsaDwPFMdyQRhOGCsmCazims1mOTNa"}]});
    async.waterfall([
      function(next) { auth.UserDatabase.fromFile("test-user-db.json", next); },
      function(db, next) { 
        data.users = [
          {"name": "yyy", "group": "zzz", "email": "z@zz", hash: "$2a$10$78IJnO/vGDi6dyH.5OovqOqJCeEcQsZlbMAHInobe9jNMEKmGRcEK"},]
        createUserAuthConf(data);
        setTimeout(function() { next(null, db); }, 2200); },
      function(db, next) {
        test.equals(1, db.users.length);
        db.checkPassword("yyy", "12345", function(err, matches) { next(err, db, matches); });
      },
    ], test.done);
  }
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

function makeRequestObj(spec) {
  return {
    headers: spec.headers || {},
    url: spec.url || '/',
    method: spec.method || 'GET',
    query: spec.query || {},
    body: spec.body || {},
    session: spec.session || {}
  }
  // 'lvUserData_2013-10-12': {
  //     username: 'robertkrahn',
  //     email: 'robert.krahn@gmail.com',
  //     group: 'admin',
  //     lastLogin: '2014-08-28T23:27:35.192Z',
  //     passwordHash: '$2a$10$XiO0.h3qJZmB2dPiO/rrleo5c15qnA6OAmdPzyCk8f1yG4SubZNL.' 
  // }

}

testSuite.AccessChainsTest = {

  tearDown: function(run) {
    cleanupAuthConfFile(run);
  },

  "add simple chain rule": function(test) {
    createUserAuthConf({
      "users": [
        {"name": "userX", "email": "x@y", hash: "$2a$10$IfbfBnl486M2rTq3flpeg.MoU80gW0O7BceVvxZvWiWZLQpnr8.vS"},
        {"name": "userY", "email": "y@z", hash: "$2a$10$IfbfBnl486M2rTq3flpeg.oKsaDwPFMdyQRhOGCsmCazims1mOTNa"}],
      "accessRules": [
        function(user, req, callback) { callback(null, user.name === "userX" ? "allow" : null); },
        function(user, req, callback) { callback(null, user.name === "userY" && req.method === "GET" ? "allow" : null); }
      ]});

    async.waterfall([
      function(next) { auth.UserDatabase.fromFile("test-user-db.json", next); },
      function(db, next) { test.equals(2, db.accessRules.length); next(null, db); },

      function(db, next) {
        var sessionCookie = {username: 'userX',passwordHash: "$2a$10$IfbfBnl486M2rTq3flpeg.MoU80gW0O7BceVvxZvWiWZLQpnr8.vS"};
        db.isRequestAllowed(
          sessionCookie, makeRequestObj({method: "GET", url: "/foo.html"}),
          function(err, isAllowed) { test.ok(isAllowed, "userX should be allowed"); next(null, db); });
      },

      function(db, next) {
        var sessionCookie = {username: 'userX', passwordHash: "wrong"};
        db.isRequestAllowed(
          sessionCookie, makeRequestObj({method: "GET", url: "/foo.html"}),
          function(err, isAllowed) { test.ok(!isAllowed, "don't allow if password does not match"); next(null, db); });
      },

      function(db, next) {
        var sessionCookie = {username: 'userY', passwordHash: "$2a$10$IfbfBnl486M2rTq3flpeg.oKsaDwPFMdyQRhOGCsmCazims1mOTNa"};
        db.isRequestAllowed(
          sessionCookie, makeRequestObj({method: "GET", url: "/foo.html"}),
          function(err, isAllowed) { test.ok(isAllowed, "GET for userY should work"); next(null, db); });
      },

      function(db, next) {
        var sessionCookie = {username: 'userY', passwordHash: "$2a$10$IfbfBnl486M2rTq3flpeg.oKsaDwPFMdyQRhOGCsmCazims1mOTNa"};
        db.isRequestAllowed(
          sessionCookie, makeRequestObj({method: "PUT", url: "/foo.html"}),
          function(err, isAllowed) { test.ok(!isAllowed, "PUT for userY should not be allowed"); next(null, db); });
      }
    ], test.done);
  }

}

module.exports.testSuite = testSuite;
