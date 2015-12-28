# CMBF Core Module

[![bitHound Overall Score](https://www.bithound.io/github/Covistra/covistra-core/badges/score.svg)](https://www.bithound.io/github/Covistra/covistra-core)
[![bitHound Code](https://www.bithound.io/github/Covistra/covistra-core/badges/code.svg)](https://www.bithound.io/github/Covistra/covistra-core)
[![bitHound Dev Dependencies](https://www.bithound.io/github/Covistra/covistra-core/badges/devDependencies.svg)](https://www.bithound.io/github/Covistra/covistra-core/master/dependencies/npm)

This module is the foundation of the framework. It imports all dependencies (including Hapi) and provide tools to quickly
setup a mobile-backend, ready to be extended with the various CMBF plugins out there.

# Starting your Mobile Backend in a few minutes

```
> npm install cmbf-core --save
```

You create an index.js file in your project and configure any loading hooks you need.


    var cmbf = require('cmbf-core');

    // All hooks handlers are processed using Promise.method from Bluebird. Returning a value or a promise is supported.
    cmbf.registerHook('configure-server', function(cfg) {
        // Add fields to the server config
        return cfg;
    });

    // All hooks are optional
    cmbf.registerHook('register-early-plugins'); // Register any system wide plugin that must be made available before any others. Default load hapi-config
    cmbf.registerHook('register-connections'); // Default to two connections: admin, api
    cmbf.registerHook('configure-connections'); // Receive an array of connection configurations (api and admin)
    cmbf.registerHook('configure-security');    // Register any auth strategy
    cmbf.registerHook('configure-documentation');   // Produce the Swagger doc options
    cmbf.registerHook('register-plugins');  // Register all required plugins in sequence
    cmbf.registerHook('register-late-plugins');  // Register any final plugins
    cmbf.registerHook('before-server-start');
    cmbf.registerHook('server-started');

    // Launch the server
    cmbf.launch()
    .then(function(){
        cmbf.log.info("Server was successfully started!");
    })
    .catch(function(err){
        cmbf.log.error("Unable to launch CMBF server", err);
    });


