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
    var authConfDir = path.dirname(authConfFile);
    // remove auth file and all of its backups
    fs.readdirSync(authConfDir)
      .filter(function(ea) { return ea.indexOf(authConfFile) === 0; })
      .forEach(function(ea) { fs.unlinkSync(path.join(authConfDir, ea)); });
    thenDo && thenDo();
  },

  cookieFromResponse: function cookieFromResponse(req) {
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
    if (fs.existsSync(authDirForLifeStar)) fs.renameSync(authDirForLifeStar, authDirForLifeStar + '.orig-' + new Date().toISOString().replace(/:/g, '_'));
    fs.symlinkSync(authDir, authDirForLifeStar, "dir");
    console.log("linking %s -> %s", authDir, authDirForLifeStar);
  }
}