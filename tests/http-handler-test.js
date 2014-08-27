/*global module, console, setTimeout*/

var path = require("path"),
    fs   = require('fs');

(function linkModuleToLifeStar() {
  var authDir = "/home/lively/expt/life_star-auth",
      lifeStarForTestDir = path.join(authDir, "node_modules/life_star"),
      authDirForLifeStar = path.join(lifeStarForTestDir, "node_modules/life_star-auth");
  if (fs.existsSync(authDirForLifeStar)) fs.unlinkSync(authDirForLifeStar);
  fs.symlinkSync(authDir, authDirForLifeStar, "dir");
})();

var testHelper   = require('life_star/tests/test-helper'),
    lifeStarTest = require("life_star/tests/life_star-test-support"),
    async        = require('async'),
    testSuite    = {};

testSuite.AuthHandlerTest = {

  tearDown: function(run) {
    lifeStarTest.shutDownLifeStar(run);
  },

  "unauthorized access refirects to login page": function(test) {
    lifeStarTest.withLifeStarDo(test, function() {
      lifeStarTest.GET('/blank.html', function(res) {
        test.equals(302, res.statusCode);
        test.equals('Moved Temporarily. Redirecting to /uvic-login?redirect=%252Fblank.html', res.body);
        test.done();
      });
    });
  }

}

module.exports.testSuite = testSuite;
