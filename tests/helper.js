var util  = require('util'),
    fs    = require('fs'),
    path  = require('path'),
    cSig  = require("cookie-signature");;

module.exports = {

  createUserAuthConf: function createUserAuthConf(authConfFile, data) {
    var toWrite = util._extend({}, data);
    toWrite.accessRules && (toWrite.accessRules = toWrite.accessRules.map(String));
    fs.writeFileSync(authConfFile, JSON.stringify(toWrite));
    return data;
  },
  
  cleanupAuthConfFile: function cleanupAuthConfFile(authConfFile, thenDo) {
    fs.unwatchFile(authConfFile);
    if (fs.existsSync(authConfFile))
      fs.unlinkSync(authConfFile);
    thenDo && thenDo();
  },

  cookieFromResponse: function cookieFromResponse(req) {
console.log(req.headers['set-cookie']);
    var cookie = req.headers['set-cookie'][0];
    var decoded = decodeURIComponent(cookie)
    var parsed = JSON.parse(decoded.slice(decoded.indexOf('{'), decoded.lastIndexOf('}')+1));
    return parsed;
  },
    
  createAuthCookie: function createAuthCookie(cookieJso) {
    return "livelykernel-sign-on=" + encodeURIComponent(
      "s:" + cSig.sign("j:" + JSON.stringify(cookieJso), "foo"));
  },

  linkLifeStarAuthModuleToLifeStar: function() {
    var authDir = path.join(__dirname, ".."),
        lifeStarForTestDir = path.join(authDir, "node_modules/life_star"),
        authDirForLifeStar = path.join(lifeStarForTestDir, "node_modules/life_star-auth");
    if (fs.existsSync(authDirForLifeStar)) fs.renameSync(authDirForLifeStar, authDirForLifeStar + '.orig');
    fs.symlinkSync(authDir, authDirForLifeStar, "dir");
    console.log("linking %s -> %s", authDir, authDirForLifeStar);
  }
}