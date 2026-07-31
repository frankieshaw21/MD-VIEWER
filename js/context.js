// Polyfill structuredClone for older Edge versions
if (typeof structuredClone === 'undefined') {
  window.structuredClone = function(obj) {
    if (obj === undefined || obj === null) return obj;
    try { return JSON.parse(JSON.stringify(obj)); }
    catch(e) { return obj; }
  };
}
// Polyfill Object.hasOwn for older Edge versions
if (!Object.hasOwn) {
  Object.hasOwn = function(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  };
}
var _mermaidScriptLoaded = false;
var _mermaidScriptError = false;

(function(global) {
  'use strict';

  const namespace = global.MDViewer || (global.MDViewer = {});

  function createContext(options) {
    options = options || {};
    const elements = Object.freeze(Object.assign({}, options.elements || {}));
    const env = Object.freeze(Object.assign({}, options.env || {}));
    const stateValues = new Map();
    const listeners = new Map();
    const ports = new Map();

    if (options.state && typeof options.state === 'object') {
      Object.keys(options.state).forEach(key => stateValues.set(key, options.state[key]));
    }

    function requireName(name, label) {
      if (typeof name !== 'string' || !name.trim()) {
        throw new TypeError(label + ' must be a non-empty string');
      }
      return name;
    }

    const state = Object.freeze({
      get: key => stateValues.get(key),
      has: key => stateValues.has(key),
      set: (key, value) => {
        requireName(key, 'State key');
        stateValues.set(key, value);
        return value;
      },
      update: (key, updater) => {
        requireName(key, 'State key');
        if (typeof updater !== 'function') throw new TypeError('State updater must be a function');
        const value = updater(stateValues.get(key));
        stateValues.set(key, value);
        return value;
      },
      remove: key => stateValues.delete(key),
      snapshot: () => {
        const snapshot = Object.create(null);
        stateValues.forEach((value, key) => { snapshot[key] = value; });
        return Object.freeze(snapshot);
      }
    });

    function on(eventName, listener) {
      requireName(eventName, 'Event name');
      if (typeof listener !== 'function') throw new TypeError('Event listener must be a function');
      let eventListeners = listeners.get(eventName);
      if (!eventListeners) {
        eventListeners = new Set();
        listeners.set(eventName, eventListeners);
      }
      eventListeners.add(listener);
      return function unsubscribe() { off(eventName, listener); };
    }

    function off(eventName, listener) {
      requireName(eventName, 'Event name');
      const eventListeners = listeners.get(eventName);
      if (!eventListeners) return false;
      if (listener === undefined) {
        listeners.delete(eventName);
        return true;
      }
      if (typeof listener !== 'function') throw new TypeError('Event listener must be a function');
      const removed = eventListeners.delete(listener);
      if (eventListeners.size === 0) listeners.delete(eventName);
      return removed;
    }

    function reportListenerError(error) {
      setTimeout(function() {
        if (global.console && typeof global.console.error === 'function') {
          global.console.error('MDViewer event listener failed:', error);
        }
      }, 0);
    }

    function emit(eventName, payload) {
      requireName(eventName, 'Event name');
      const eventListeners = listeners.get(eventName);
      if (!eventListeners) return 0;
      const currentListeners = Array.from(eventListeners);
      currentListeners.forEach(listener => {
        try { listener(payload, context); }
        catch (error) { reportListenerError(error); }
      });
      return currentListeners.length;
    }

    function registerPort(name, port, registrationOptions) {
      requireName(name, 'Port name');
      const replace = Boolean(registrationOptions && registrationOptions.replace);
      if (ports.has(name) && !replace) throw new Error('Port already registered: ' + name);
      if (port === undefined || port === null) throw new TypeError('Port must not be null or undefined');
      ports.set(name, port);
      return port;
    }

    function getPort(name) {
      requireName(name, 'Port name');
      return ports.get(name);
    }

    function hasPort(name) {
      requireName(name, 'Port name');
      return ports.has(name);
    }

    const context = Object.freeze({
      elements: elements,
      env: env,
      state: state,
      on: on,
      off: off,
      emit: emit,
      registerPort: registerPort,
      getPort: getPort,
      hasPort: hasPort
    });
    return context;
  }

  namespace.Context = Object.freeze({ createContext: createContext });
})(window);