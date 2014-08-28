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
  fs.writeFileSync(authConfFile, JSON.stringify(data));
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

module.exports.testSuite = testSuite;
