(() => {
  "use strict";

  function createStore(initialState = {}) {
    const listeners = new Map();
    const state = initialState;

    function on(event, handler) {
      if (typeof handler !== "function") return () => {};
      const set = listeners.get(event) || new Set();
      set.add(handler);
      listeners.set(event, set);
      return () => {
        set.delete(handler);
        if (!set.size) listeners.delete(event);
      };
    }

    function emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      [...set].forEach((handler) => {
        try { handler(payload, state); } catch (error) { console.error("AshurStore listener error", error); }
      });
    }

    function patch(values, event = "state:change") {
      if (!values || typeof values !== "object") return state;
      Object.assign(state, values);
      emit(event, values);
      return state;
    }

    return { state, on, emit, patch };
  }

  function createRouter({ initialRoute = "homePage", history = [], maxHistory = 20, isValid } = {}) {
    const stack = Array.isArray(history) ? history : [];
    let current = initialRoute;

    function resolve(route) {
      const candidate = typeof route === "string" && route ? route : initialRoute;
      return typeof isValid === "function" && !isValid(candidate) ? initialRoute : candidate;
    }

    function navigate(route, { current: currentRoute = current, fromBack = false, replace = false } = {}) {
      const next = resolve(route);
      const previous = resolve(currentRoute);
      if (!fromBack && !replace && previous !== next) {
        stack.push(previous);
        if (stack.length > maxHistory) stack.splice(0, stack.length - maxHistory);
      }
      current = next;
      return next;
    }

    function back(fallback = initialRoute) {
      const next = stack.length ? stack.pop() : resolve(fallback);
      current = resolve(next);
      return current;
    }

    function reset(route = initialRoute) {
      stack.splice(0, stack.length);
      current = resolve(route);
      return current;
    }

    function getCurrent() { return current; }
    function getHistory() { return [...stack]; }

    return { resolve, navigate, back, reset, getCurrent, getHistory };
  }

  window.AshurCore = Object.freeze({ createStore, createRouter });
})();