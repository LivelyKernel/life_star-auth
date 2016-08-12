# life_star-auth [![Build Status](https://travis-ci.org/LivelyKernel/life_star-auth.svg)](https://travis-ci.org/LivelyKernel/life_star-auth)

Authentication and authorization for Lively Web servers.

## Usage

### `LivelyKernel/core/lively/localconfig.js`

```js
lively.Config.set("userAuthEnabled", true);
lively.Config.set("usersFile", "user-db.json");
lively.Config.get('authRequireLogin', {login: null});
```

### LivelyKernel/user-db.json`

```json
{
  "users": [],
  "accessRules": [
    "function(userDB, user, req, callback) { callback(null, req.method === 'PUT' ? 'deny' : 'allow'); }"
  ]
}
```

`user-db.json` can be modified while the server is running, it will be
automatically updated.

`accessRules` can be functions returning `'allow'`, `'deny'` or a falsy value
(undecided) via the callback. If request is denied a 403 response is send.



## License

[MIT License](LICENSE)