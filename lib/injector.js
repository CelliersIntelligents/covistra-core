
function Injector() {
    this.deps = {};
}

Injector.prototype.register = function(key, impl) {
    this.deps[key] = impl;
};

Injector.prototype.inject = function(key) {
    return this.deps[key];
};

module.exports = Injector;

