var cmbf = require('../');
var path = require('path');
var P = require('bluebird');
var fs = require('fs');
var _ = require('lodash');
var sinon = require('sinon');

// Register all test hooks before launching the test server
if(fs.existsSync(path.resolve('./test/test-server-hooks.js'))) {
    cmbf.log.info("Registering all test server hooks");
    var hooks = require(path.resolve('./test/test-server-hooks'));

    _.each(_.keys(hooks), function(hookKey) {
        cmbf.registerHook(hookKey, hooks[hookKey]);
    });

    cmbf.log.info("All %d hooks were successfully registered", _.keys(hooks).length);
}

module.exports = cmbf.launch({testMode: true}).then(function() {
    cmbf.log.info("CMBF test server was successfully launched!");
    var ctx = {};

    // Build the test context
    var systemLog = cmbf.server.plugins['covistra-system'].systemLog;
    var config = cmbf.server.plugins['hapi-config'].CurrentConfiguration;

    ctx.server = cmbf.server;
    ctx.log = systemLog;
    ctx.config = config;

    cmbf.server.decorate('server', 'context', ctx);

    ctx.shutdown = function() {
        cmbf.log.info("Test server was successfully terminated");
        process.exit(0);
    };

    ctx.success = function(cb) {
        return function() {
            return cb();
        };
    };

    ctx.callHook = function() {
        return cmbf.callHook.apply(cmbf, arguments);
    };

    ctx.inject = function(modulePath) {
        return require(path.resolve(modulePath))(ctx.server, ctx.config, ctx.log);
    };

    // Loop through all registered plugins and ask them to expose their test mode services
    _.map( _.values(cmbf.server.plugins), function(plugin){
        if(_.isFunction(plugin.setupTestMode)) {
            return plugin.setupTestMode(ctx);            
        }
    })

    cmbf.test_ctx = P.props(ctx);
    console.log("Assigning test_ctx: " + cmbf.test_ctx + " with id " + cmbf.id);
    return cmbf.test_ctx;

})

.catch(function(err) {
   cmbf.log.error("Unable to launch CMBF server in test mode", err);
});
