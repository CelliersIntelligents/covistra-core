var gulp = require('gulp');
var mocha = require('gulp-mocha');
var minimist = require('minimist');
var istanbul = require('gulp-istanbul');

var knownOptions = {
    string: 'env',
    default: {env: process.env.NODE_ENV || 'production'}
};

var options = minimist(process.argv.slice(2), knownOptions);


gulp.task('coverage', function () {
    var tests = [], src = ['!./plugins/admin/**/*.js', '!./plugins/**/test/**/*.js'];

    // Build our test target
    if (options.target) {
        console.log("Executing %s plugin unit tests", options.target);
        tests.push('./plugins/' + options.target + "/test/unit/**/*-spec.js");
        src.unshift('./plugins/' + options.target + "/**/*.js");
    }
    else {
        console.log("Executing all plugins unit tests");
        tests.push('./plugins/**/test/unit/**/*-spec.js');
        src.unshift('./plugins/**/*.js');
    }

    return gulp.src(src)
        .pipe(istanbul({includeUntested: true}))
        .pipe(istanbul.hookRequire())
        .on('finish', function () {

            return require('./tests/setup').then(function (ctx) {

                return gulp.src(tests, {read: false})
                    .pipe(mocha({reporter: 'spec'}))
                    .pipe(istanbul.writeReports())
                    .pipe(istanbul.enforceThresholds({ thresholds: { global: 0 } }))
                    .on('end', function () {
                        ctx.shutdown();
                    });
            });
        });

});

gulp.task('unit', function () {
    var src = [];

    return require('./test/test-server').then(function (ctx) {
        console.dir(ctx);

        // Build our test target
        if (options.target) {
            console.log("Executing %s plugin unit tests", options.target);
            src.push('./plugins/' + options.target + "/test/unit/**/*-spec.js");
        }
        else {
            console.log("Executing all plugins unit tests");
            src.push('./test/unit/**/*-spec.js');
        }

        return gulp.src(src, {read: false})
            .pipe(mocha({reporter: 'spec'}))
            .on('end', function () {
                ctx.shutdown();
            });
    });

});