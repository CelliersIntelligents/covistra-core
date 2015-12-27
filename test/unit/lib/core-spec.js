var Cmbf = require('../../../.');

describe('core', function() {
    var ctx, credentials;

    before(function () {
        return Cmbf.test_ctx.then(function (result) {
            ctx = result;

            credentials = {
                emitter: ctx.data.credentials.validUser1,
                bearer: ctx.data.credentials.validUser1,
                application: ctx.data.applications.unitTest,
                token: "valid-test-token",
                profile: {}
            };

        });
    });

    describe('launch', function() {

        it('should launch plugins in testMode is testMode option is provided', function(done){
            done();
        });
    });

});