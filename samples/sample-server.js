var cmbf = require('../');

cmbf.launch().then(function() {
    cmbf.log.info("Successfully started");
}).catch(function(err){
    cmbf.log.error("Unable to launch server", err);
});
