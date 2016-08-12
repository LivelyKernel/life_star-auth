# life_star-auth [![Build Status](https://travis-ci.org/LivelyKernel/life_star-auth.svg)](https://travis-ci.org/LivelyKernel/life_star-auth)

Authentication and authorization for Lively Web servers.

## Usage

### `LivelyKernel/core/lively/localconfig.js`

```js
lively.Config.userAuthEnabled = true;
lively.Config.usersFile = "user-db.json";
lively.Config.authRequireLogin = false;
```

### LivelyKernel/user-db.json`

```json
{
  "users": [{"name": "test-user", "email": "", "password": "xxx"}],
  "accessRules": [
    "function(userDB, user, req, callback) { if (user && user.name === 'test-user') callback(null, 'allow'); else callback(null, req.method === 'PUT' ? 'deny' : 'allow'); }"
  ]
}
```

`user-db.json` can be modified while the server is running, it will be
automatically updated.

`accessRules` can be functions returning `'allow'`, `'deny'` or a falsy value
(undecided) via the callback. If request is denied a 403 response is send.

`user` objects can have the fields:

- `name` : `String`
- `email` : `String`
- `password` : `String` (optional, will be replaced with a password hash once the server starts! No passwords are stored.)
- custom fields, whatever makes sense for applications. E.g. a field groups (Array) is used in Lively apps to create rules for several users at once.

User objects are automatically created when a user registers but can be added and modified by changing `user-db.json`.

## License

[MIT License](LICENSE)