/*global module, console, setTimeout, __dirname*/

var path = require("path"),
    fs   = require('fs');

(function linkModuleToLifeStar() {
  var authDir = path.join(__dirname, ".."),
      lifeStarForTestDir = path.join(authDir, "node_modules/life_star"),
      authDirForLifeStar = path.join(lifeStarForTestDir, "node_modules/life_star-auth");
  if (fs.existsSync(authDirForLifeStar)) fs.unlinkSync(authDirForLifeStar);
  fs.symlinkSync(authDir, authDirForLifeStar, "dir");
  console.log("linking %s -> %s", authDir, authDirForLifeStar);
})();

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

var testHelper   = require('life_star/tests/test-helper'),
    lifeStarTest = require("life_star/tests/life_star-test-support"),
    async        = require('async'),
    testSuite    = {},
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


testSuite.AuthHandlerTest = {

  setUp: function(run) {
    lifeStarTest.createDirStructure(__dirname, {
      "test-dir": {"bar.js": "content 123", "foo.html": "<h1>hello world</h1>"}});
   createUserAuthConf({"users": [
      {"name": "xx", "group": "yy", "email": "x@y", hash: "$2a$10$IfbfBnl486M2rTq3flpeg.MoU80gW0O7BceVvxZvWiWZLQpnr8.vS"},
      {"name": "ab", "group": "de", "email": "a@b", hash: "$2a$10$IfbfBnl486M2rTq3flpeg.oKsaDwPFMdyQRhOGCsmCazims1mOTNa"}]});
    run();
  },

  tearDown: function(run) {
    async.series([
      cleanupAuthConfFile,
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

  // "do login": function(test) {
  //   lifeStarTest.withLifeStarDo(test, function() {
  //     lifeStarTest.POST('/foo.html', function(res) {
  //       test.equals(302, res.statusCode);
  //       test.equals('Moved Temporarily. Redirecting to /test-login?redirect=%252Ffoo.html', res.body);
  //       test.done();
  //     });
  //   }, {authConf: {authenticationEnabled: true, cookieField: "test-auth-cookie"},
  //       fsNode: path.join(__dirname, "test-dir")});
  // }

}

module.exports.testSuite = testSuite;
