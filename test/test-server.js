var cmbf = require('../');
var requireDirectory = require('require-directory');
var path = require('path');

module.exports = cmbf.launch({testMode: true}).then(function() {
    cmbf.log.info("CMBF test server was successfully launched!");
    var ctx = {};

    // Build the test context
    var systemLog = cmbf.server.plugins['covistra-system'].systemLog;
    var config = cmbf.server.plugins['hapi-config'].CurrentConfiguration;

    ctx.server = cmbf.server;
    ctx.log = systemLog;
    ctx.config = config;

    ctx.shutdown = function() {
        cmbf.log.info("Test server was successfully terminated");
        process.exit(0);
    };
    ctx.cleanUp = cmbf.server.plugins['covistra-mongodb'].cleanUp;
    ctx.cleanUpRef = cmbf.server.plugins['covistra-mongodb'].cleanUpRef;
    ctx.success = function(cb) {
        return function() {
            return cb();
        };
    };

    // Load all test data
    ctx.data = cmbf.callHook('load-fixtures', function() {
        return cmbf.server.plugins['covistra-mongodb'].loadFixtures(path.resolve('./test/fixtures'));
    });

    ctx.ObjectId = cmbf.server.plugins['covistra-mongodb'].ObjectId;

    return P.props(ctx);
})

.catch(function(err) {
   cmbf.log.error("Unable to launch CMBF server in test mode", err);
});
