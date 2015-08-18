
describe('core', function() {
    var ctx, credentials;

    before(function (done) {
        require('../../test-server').then(function (result) {
            ctx = result;

            credentials = {
                emitter: ctx.data.credentials.validUser1,
                bearer: ctx.data.credentials.validUser1,
                application: ctx.data.applications.unitTest,
                token: "valid-test-token",
                profile: {}
            };

            done();
        });
    });

    describe('launch', function() {

        it('should launch plugins in testMode is testMode option is provided', function(done){
            done();
        });
    });

});