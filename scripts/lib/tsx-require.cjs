/**
 * Load the project's .tsx straight into Node, so a component can be rendered
 * and read back in a test.
 *
 * Next compiles these with SWC and jiti 1.x refuses to treat .tsx as
 * TypeScript at all, so neither is available here. TypeScript's own
 * transpileModule is, it is already a dependency, and it is a stable public
 * API — so that is what does the work.
 *
 * Three modules are stubbed rather than loaded. next/link wants a router that
 * only exists inside a request, framer-motion animates nothing without a
 * browser, and lucide-react is a thousand icon files. None of them affect the
 * things these tests assert — which cards appear, which are locked, and what
 * the locked ones say — and all three would otherwise turn a fast check into a
 * slow and flaky one.
 */

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");

const ROOT = path.resolve(__dirname, "..", "..");

// ── compile ────────────────────────────────────────────────────────────────

function compile(source, filename) {
  return ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      // The automatic runtime, same as Next. These files do not import React
      // themselves, so the classic transform would emit React.createElement
      // against an undefined name.
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      allowJs: true,
      // The directive is meaningless outside Next and is not valid JS at the
      // top of a CommonJS module body, but TypeScript keeps it as a string
      // expression, which is harmless.
      verbatimModuleSyntax: false,
    },
  }).outputText;
}

for (const ext of [".ts", ".tsx"]) {
  Module._extensions[ext] = function (mod, filename) {
    mod._compile(compile(fs.readFileSync(filename, "utf8"), filename), filename);
  };
}

// ── stubs ──────────────────────────────────────────────────────────────────

const h = React.createElement;

/** Renders the anchor, which is all these tests look at. */
const LinkStub = ({ href, children, ...rest }) => h("a", { href, ...rest }, children);

/** motion.div, motion.section, … all become the plain tag. */
const motionStub = new Proxy({}, {
  get: (_t, tag) => ({ children, initial, animate, transition, whileHover, whileTap, exit, ...rest }) =>
    h(typeof tag === "string" ? tag : "div", rest, children),
});

/** Every icon is one empty <svg>, tagged so a test could look for it. */
const iconStub = new Proxy({}, {
  get: (_t, name) => {
    if (name === "__esModule") return true;
    const Icon = (props) => h("svg", { ...props, "data-icon": String(name) });
    Icon.displayName = String(name);
    return Icon;
  },
});

const STUBS = new Map([
  ["next/link", { __esModule: true, default: LinkStub }],
  ["framer-motion", { __esModule: true, motion: motionStub, AnimatePresence: ({ children }) => children }],
  ["lucide-react", iconStub],
]);

// ── resolution: the @/ alias, and the stubs ────────────────────────────────

const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (STUBS.has(request)) return request;
  if (request.startsWith("@/")) {
    const base = path.join(ROOT, request.slice(2));
    for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"]) {
      if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) {
        return realResolve.call(this, base + ext, ...rest);
      }
    }
    return realResolve.call(this, base, ...rest);
  }
  return realResolve.call(this, request, ...rest);
};

const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (STUBS.has(request)) return STUBS.get(request);
  return realLoad.call(this, request, ...rest);
};

module.exports = { require: (p) => require(path.isAbsolute(p) ? p : path.join(ROOT, p)) };
