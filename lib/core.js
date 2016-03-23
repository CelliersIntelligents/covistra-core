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
    Injector = require('./injector'),
    _ = require('lodash');

var formatOut = bformat({ outputMode: 'short' });

function CMBF() {
    this.plugins = [];
    this.hooks = {};
    this.injector = new Injector();
    this.log = bunyan.createLogger({name: 'core', level: process.env.SYSTEM_LOG_LEVEL || 'info', stream: formatOut});

    if(process.env.NODE_ENV !== 'production') {
        this.log.warn("Enabling Bluebird long stack trace in development and samples mode");
        P.longStackTraces();
    }

}

CMBF.prototype.registerHook = function(key, hookHandler) {
    this.log.debug("Registering hook %s", key);
    this.hooks[key] = P.method(hookHandler);
};

CMBF.prototype.registerHooks = function(hooks) {
    var _this = this;
    return _.each(_.keys(hooks), function(hookKey) {
        _this.registerHook(hookKey, hooks[hookKey]);
    });
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
        this.log.trace("No hook found, let's continue");
        return P.resolve(params);
    }

};

CMBF.prototype.waitFor = function(deps, options) {
    var _this = this;
    options = options || { timeout: 0};

    // Make sure each entry is pre-created
    var depsResolvers = P.map(deps, function(dep) {

        // Record our entry if not already in there (someone maybe already waiting for us)
        var entry = _.find(_this.plugins, function(p) { return p.name === dep});
        if(!entry) {
            entry = {
                name: dep,
                resolver: {}
            };

            entry.resolver.promise = new P(function() {
                entry.resolver.resolve = arguments[0];
                entry.resolver.reject = arguments[1];
            });

            _this.plugins.push(entry);
        }

        return entry.resolver.promise;
    });

    _this.log.debug("Plugin %s is waiting for deps ", options.debug, deps);

    return P.all(depsResolvers).timeout(options.timeout).then(function() {
        _this.log.info("All dependencies for plugin %s were successfully loaded", options.debug);
    }).catch(function() {
        _this.log.error("Unable to load plugin %s. Was waiting for deps", options.debug, deps);

        _this.log.error("Dumping plugin state for easier debugging");
        _.each(_this.plugins, function(plugin) {
            _this.log.error("Plugin %s: ", plugin.plugin.register.attributes.pkg.name, plugin.resolver.promise._settledValue);
        });
    });
};

CMBF.prototype.installPlugin = P.method(function(plugin, options) {
    var _this = this;
    options = options || {};

    var path = plugin.register.attributes.pkg.name;
    _this.log.debug("Installing plugin %s", path);

    // Record our entry if not already in there (someone maybe already waiting for us)
    var entry = _.find(this.plugins, function(p) { return p.name === plugin.register.attributes.pkg.name});
    if(!entry) {
        _this.log.trace("Plugin %s does not exist, let's pre-created the entry", path);
        entry = {
            name: plugin.register.attributes.pkg.name,
            version: plugin.register.attributes.pkg.version,
            plugin: plugin,
            options: options,
            resolver: {}
        };

        entry.resolver.promise = new P(function() {
            entry.resolver.resolve = arguments[0];
            entry.resolver.reject = arguments[1];
        });

        this.plugins.push(entry);
    }
    else {
        _this.log.trace("Plugin %s was already pre-registered. Updating implementation and version only", path);
        entry.version =plugin.register.attributes.pkg.version;
        entry.plugin = plugin
    }

    // Wait for any dependencies and register the plugin
    return this.waitFor(plugin.deps || options.deps || [], {debug: entry.name, timeout: 5000}).then(function() {
        _this.log.trace("Plugin %s dependencies are all resolved", entry.name, entry.options);
        return P.promisify(_this.server.register, _this.server)({register: entry.plugin, options:entry.options.runtime}).then(function() {
            _this.log.trace("Indicating plugin %s has resolved", path);
            entry.resolver.resolve();
        }).catch(function(err) {
            _this.log.error("Unable to register plugin %s. ", path, err);
            entry.resolver.reject(err);
        });
    }).catch(function(err) {
        _this.log.error("Error while registering plugin %s", path, err);
    });

});

CMBF.prototype.launch = P.method(function(pluginOpts) {
    var _this = this;
    this.log.info("Initiating the CMBF launch process");

    var caches = [{
        name: 'memoryCache',
        engine: require('catbox-memory'),
        allowMixedContent: true
    }];

    if(process.env.CACHE_MONGODB_HOST) {
        caches.push(            {
            name: 'mongoCache',
            engine: require('catbox-mongodb'),
            host: process.env.CACHE_MONGODB_HOST,
            port: process.env.CACHE_MONGODB_PORT,
            username: process.env.CACHE_MONGODB_USERNAME,
            password: process.env.CACHE_MONGODB_PASSWORD,
            poolSize: process.env.CACHE_MONGODB_POOLSIZE,
            partition: 'cache'
        });
    }

    if(process.env.CACHE_REDIS_HOST) {
        caches.push(            {
            name: 'redisCache',
            engine: require('catbox-redis'),
            host: process.env.CACHE_REDIS_HOST,
            port: process.env.CACHE_REDIS_PORT,
            password: process.env.CACHE_REDIS_PASSWORD,
            database: process.env.CACHE_REDIS_DATABASE,
            partition: 'cache'
        });
    }

    // Initializing the Hapi server
    var serverOpts = {
        cache: caches,
        debug: {
            request: ['error', 'warning']
        }
    };

    // Configure the server
    return _this.callHook('configure-server', serverOpts).then(function(opts) {
        _this.log.trace("Server configuration will be", opts);
        var server = new Hapi.Server(opts);

        _this.server = server;
        server.decorate('server', 'cmbf', _this);
        server.method('getCmbf', function() { return _this }, {});

        // Register early plugins (default load config)
        return _this.callHook('register-early-plugins', {server:server, pluginOptions: pluginOpts}, function() {
            _this.log.debug("Register Early Plugin: hapi-config");
            return P.join(
                P.promisify(server.register, server)({register: require('hapi-config'), options: pluginOpts})
            );
        })

        // Register all connections
        .then(function() {

            // Retrieve the computed configuration
            var config = server.plugins['hapi-config'].CurrentConfiguration;

            server.decorate('server', 'config', config);

            // Register all required dependencies
            return _this.callHook('inject-dependencies', {injector: _this.injector}).then(function() {

                return _this.callHook('register-connections', {server:server, config:config}, function() {
                    _this.log.debug("Configuring server connections");

                    if (!config) {
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
                    if (config.get('ADMIN_PORT')) {
                        _this.log.debug("Detected a separate ADMIN_PORT %d. Configure a separate server connection", config.get('ADMIN_PORT'));
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
                        apiOpts.labels.push('admin');
                        connections.push(apiOpts);
                    }

                    return _this.callHook('configure-connections', {
                        config: config,
                        server: server,
                        connections: connections
                    }).then(function (result) {
                        _this.log.debug("%d connections will be configured for our server", result.connections.length);
                        return P.each(result.connections, function (connectionOpts) {
                            server.connection(connectionOpts);
                        });
                    });
                });

            })

            // Register security plugins (auth strategies)
            .then(function() {
                _this.log.debug("Configure security plugin strategies");
                return _this.callHook('configure-security', {server:server, config:config, pluginOptions: pluginOpts}, function() {
                    _this.log.debug("Configure Security: Loading 3 auth strategies: hapi-auth-bearer-token, hapi-auth-cookie, hapi-auth-basic");
                    var registerPlugin = P.promisify(server.register, server);
                    return P.join(
                        registerPlugin({register: require('hapi-auth-bearer-token'), options: pluginOpts}),
                        registerPlugin({register: require('hapi-auth-cookie'), options: pluginOpts}),
                        registerPlugin({register: require('hapi-auth-basic'), options: pluginOpts})
                    );

                });

            })

            // Configure the documentation (Swagger)
            .then(function() {
                _this.log.debug("Configuring API documentation plugin (Swagger)");

                var swaggerOpts = {
                    schemes:[config.get('PROTOCOL', 'http')],
                    host: config.get('HOST', 'localhost:5000'),
                    info: config.get('server:info'),
                    tags: config.get('server.tags')
                };

                return _this.callHook('configure-documentation', {server:server, config:config, swaggerOpts:swaggerOpts}).then(function(result) {
                    _this.log.debug("Configuring Documentation: Swagger plugin will be loaded with configuration", result.swaggerOpts);
                    var registerPlugin = P.promisify(server.register, server);
                    return P.join(
                        registerPlugin({register: require('inert'), options: _.defaults(config.get('plugins:inert:options',{}), pluginOpts)}),
                        registerPlugin({register: require('vision'), options: _.defaults(config.get('plugins:vision:options',{}), pluginOpts)}),
                        registerPlugin({register: require('hapi-swagger'), options: result.swaggerOpts}),
                        registerPlugin({register: require('chairo'), options: _.defaults(config.get('plugins:chairo:options',{}), pluginOpts) })
                    );
                });
            })

            // Register all plugins
            .then(function() {
                _this.log.debug("Registering all server plugins");
                return _this.callHook('register-plugins', {server:server, config:config, pluginOptions: pluginOpts}, function() {
                    var registerPlugin = P.promisify(server.register, server);
                    var availablePlugins = config.get('server:framework', ['covistra-system']);
                    _this.log.info("Loading default foundation plugins: hapi-bunyan", availablePlugins);
                    return registerPlugin({
                        register: require('hapi-bunyan'),
                        options: {
                            logger: bunyan.createLogger(_.merge(config.get('server:log', {}), { name: 'cmbf', stream: formatOut }))
                        }
                    }).then(function() {
                        return P.map(availablePlugins, function(plugin) {
                            _this.log.debug("Registering core framework plugin %s", plugin);
                            _this.installPlugin(require(plugin), {runtime: pluginOpts});
                        });
                    }).then(function() {
                        _this.log.info("All available framework plugins were successfully registered");
                    });

                });
            })

            // Register late plugins
            .then(function() {
                _this.log.debug("Registering late plugins");
                return _this.callHook('register-late-plugins', {server:server, config:config, pluginOptions: pluginOpts});
            });
        })

        // Perform pre-start global configuration
        .then(function() {
            _this.log.debug("All plugins are loaded and ready. Performing pre-start logic");
            return _this.callHook('before-server-start', { server: server });
        })

        // Launch the server
        .then(function() {
            _this.log.debug("Starting the server");
            return P.promisify(server.start, server)().then(function() {
                return _this.callHook('server-started', { server: server});
            });
        })

        // Launch is complete
        .then(function() {
            _this.log.debug("Server was successfully started", server.info);
            return _this;
        });

    });

});

module.exports = CMBF;

