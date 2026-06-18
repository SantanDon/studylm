import "@testing-library/jest-dom";

// localStorage mock with non-enumerable methods so Object.keys() returns stored items
function createStorageMock() {

  const handler: ProxyHandler<Record<string, string>> = {
    get(target, prop) {
      if (prop === 'getItem') return (key: string) => target[key] ?? null;
      if (prop === 'setItem') return (key: string, value: string) => { target[key] = String(value); };
      if (prop === 'removeItem') return (key: string) => { delete target[key]; };
      if (prop === 'clear') return () => { Object.keys(target).forEach(k => delete target[k]); };
      if (prop === 'length') return Object.keys(target).length;
      if (prop === 'key') return (index: number) => Object.keys(target)[index] ?? null;
      return target[prop as string] ?? null;
    },
    set(target, prop, value) {
      target[prop as string] = String(value);
      return true;
    },
    deleteProperty(target, prop) {
      return delete target[prop as string];
    },
    ownKeys(target) {
      return Object.keys(target);
    },
    getOwnPropertyDescriptor(target, prop) {
      if (prop in target) {
        return { enumerable: true, configurable: true, value: target[prop] };
      }
      return undefined;
    },
    has(target, prop) {
      return prop in target;
    },
  };

  return new Proxy({}, handler) as unknown as Storage;
}

const localStorageMock = createStorageMock();
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });
Object.defineProperty(globalThis, "window", { value: globalThis });

// Blob.arrayBuffer polyfill for jsdom
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// ResizeObserver polyfill for embla-carousel
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// IntersectionObserver polyfill for embla-carousel
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
    root = null;
    rootMargin = '';
    thresholds = [];
  } as unknown as typeof IntersectionObserver;
}

// matchMedia polyfill for embla-carousel
if (typeof globalThis.matchMedia === 'undefined') {
  globalThis.matchMedia = function (query: string) {
    return {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList;
  };
}

// DOMMatrix polyfill for pdfjs-dist
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    constructor() {}
    translate() { return this; }
    scale() { return this; }
    rotate() { return this; }
    multiply() { return this; }
    inverse() { return this; }
    isIdentity = true;
  } as unknown as typeof DOMMatrix;
}
