/**

 Copyright 2015 Covistra Technologies Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */
var P = require('bluebird'),
    bunyan = require('bunyan'),
    Hapi = require('hapi'),
    bformat = require('bunyan-format'),
    _ = require('lodash');

var formatOut = bformat({ outputMode: 'short' });

function CMBF() {
    this.hooks = {};
    this.log = bunyan.createLogger({name: 'core', level: 'debug'});

    if(process.env.NODE_ENV !== 'production') {
        this.log.warn("Enabling Bluebird long stack trace in development and samples mode");
        P.longStackTraces();
    }
}

CMBF.prototype.registerHook = function(key, hookHandler) {
    this.log.debug("Registering hook %s", key);
    this.hooks[key] = P.method(hookHandler);
};

/**
 * Generic hook calling helper. All hooks are promised-wrapped. DefaultImpl will be called
 * if no hook is present and will be passed to hooks for default implementation chaining.
 *
 * @param key
 * @param params
 * @param defaultImpl
 * @returns {*}
 */
CMBF.prototype.callHook = function(key, params, defaultImpl) {
    this.log.debug("Calling hook %s", key);

    if(arguments.length === 2 && _.isFunction(params)) {
        defaultImpl = params;
        params = {};
    }

    var hook = this.hooks[key];
    if(hook) {
        this.log.trace("Registered hook %s will be used", key);
        return P.method(hook).call(this, params, defaultImpl);
    }
    else if(defaultImpl) {
        this.log.trace("No registered hook %s was found but a default implementation was provided", key);
        return P.method(defaultImpl)(params);
    }
    else {
        return P.resolve(params);
    }

};

CMBF.prototype.launch = P.method(function(pluginOpts) {
    var _this = this;
    this.log.info("Initiating the CMBF launch process");

    // Initializing the Hapi server
    var serverOpts = {
        cache: [{
            engine: require('catbox-memory')
        }],
        debug: {
            request: ['error', 'warning']
        }
    };

    // Configure the server
    return this.callHook('configure-server', serverOpts).then(function(opts) {
        _this.log.trace("Server configuration will be", opts);
        var server = new Hapi.Server(opts);

        // Register early plugins (default load config)
        return _this.callHook('register-early-plugins', {server:server}, function() {
            _this.log.debug("Register Early Plugin: hapi-config, inert, vision");
            return P.join(
                P.promisify(server.register, server)({register: require('hapi-config'), options: pluginOpts})
            );

        })

        // Register all connections
        .then(function() {

            // Retrieve the computed configuration
            var config = server.plugins['hapi-config'].CurrentConfiguration;

            return _this.callHook('register-connections', {server:server, config:config}, function() {
                _this.log.debug("Configuring server connections");

                if(!config) {
                    throw new Error("Missing hapi-config plugin. Must be loaded in the register-early-plugin hook");
                }

                var connections = [];

                var apiOpts = {
                    port: config.get('PORT'),
                    labels: ['api'],
                    router: {
                        stripTrailingSlash: true
                    },
                    routes: {
                        cors: {
                            additionalHeaders: ['X-App-Key', 'X-Unsafe-Auth'],
                            credentials: true
                        },
                        payload: {
                            maxBytes: 1024 * 1024 * 1024 * 64
                        }
                    }
                }, adminOpts;

                // Serve admin through the same connection if no specific ADMIN_PORT is defined
                if(config.get('ADMIN_PORT')) {
                    log.debug("Detected a separate ADMIN_PORT %d. Configure a separate server connection",config.get('ADMIN_PORT') );
                    adminOpts = {
                        port: config.get('ADMIN_PORT'),
                        labels: ['admin'],
                        router: {
                            stripTrailingSlash: true
                        },
                        routes: {
                            payload: {
                                maxBytes: 1024 * 1024 * 1024 * 64
                            }
                        }
                    };
                    connections.push(apiOpts);
                    connections.push(adminOpts);
                }
                else {
                    apiOpts.labels.push('admin')
                    connections.push(apiOpts);
                }

                return _this.callHook('configure-connections', {config:config, server:server, connections:connections}).then(function(result) {
                    _this.log.debug("%d connections will be configured for our server", result.connections.length);
                    return P.each(result.connections, function(connectionOpts){
                        server.connection(connectionOpts);
                    });

                });

            })

            // Register security plugins (auth strategies)
            .then(function() {

                return _this.callHook('configure-security', {server:server, config:config}, function() {
                    _this.log.debug("Configure Security: Loading 3 auth strategies: hapi-auth-bearer-token, hapi-auth-cookie, hapi-auth-basic");

                    return P.join(
                        P.promisify(server.register, server)({register: require('hapi-auth-bearer-token'), options: pluginOpts}),
                        P.promisify(server.register,server)({register: require('hapi-auth-cookie'), options: pluginOpts}),
                        P.promisify(server.register, server)({register: require('hapi-auth-basic'), options: pluginOpts})
                    );

                });

            })

            // Configure the documentation (Swagger)
            .then(function() {
                _this.log.debug("Configuring API documentation plugin (Swagger)");

                var swaggerOpts = {
                    basePath: config.get('server:prod:baseUrl'),
                    apiVersion: config.get('server:version'),
                    authorizations: {
                        "bearer-access-token" : {
                            type: "apiKey",
                            passAs: 'header',
                            keyName: 'Authorization'
                        }
                    },
                    info: config.get('server:info')
                };

                return _this.callHook('configure-documentation', {server:server, config:config, swaggerOpts:swaggerOpts}).then(function(result) {
                    _this.log.debug("Configuring Documentation: Swagger plugin will be loaded with configuration", result.swaggerOpts);
                    return P.join(
                        P.promisify(server.register, server)({register: require('inert'), options: pluginOpts}),
                        P.promisify(server.register, server)({register: require('vision'), options: pluginOpts}),
                        P.promisify(server.register, server)({register: require('hapi-swagger'), options: result.swaggerOpts})
                    );
                });
            })

            // Register all plugins
            .then(function() {
                _this.log.debug("Loading all plugins");
                return _this.callHook('register-plugins', {server:server, config:config}, function() {
                    _this.log.debug("Loading default foundation plugins: hapi-bunyan, covistra-system, covistra-mongodb, covistra-security, covistra-admin");

                    return P.join(
                        P.promisify(server.register, server)({
                            register: require('hapi-bunyan'),
                            options: {
                                logger: bunyan.createLogger(_.merge(config.get('server:log')||{}, { name: 'cmbf', stream: formatOut }))
                            }
                        }),
                        P.promisify(server.register, server)({register: require('covistra-system'), options: pluginOpts}),
                        P.promisify(server.register, server)({register: require('../../covistra-mongodb'), options: pluginOpts}),
                        P.promisify(server.register, server)({register: require('covistra-security'), options: pluginOpts}),
                        P.promisify(server.register, server)({register: require('covistra-admin'), options: pluginOpts})
                    );
                });
            })

            // Register late plugins
            .then(function() {
                _this.log.debug("Registering late plugins");
                return _this.callHook('register-late-plugins', {server:server, config:config});
            });
        })

        // Launch the server
        .then(function() {
            _this.log.debug("Preparing to start the server");
            return _this.callHook('before-server-start', { server: server })

            .then(function() {
                _this.log.debug("Starting the server");
                return P.promisify(server.start, server)();
            })

            .then(function() {
               return _this.callHook('server-started', { server: server});
            });

        })

        // Launch is complete
        .then(function() {
            _this.log.debug("Server was successfully started", server.info);
            _this.server = server;
            return _this;
        });

    });

});

module.exports = CMBF;

