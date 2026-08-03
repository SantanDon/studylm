#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const acceptedAdvisory = "https://github.com/advisories/GHSA-qwww-vcr4-c8h2";
const allowedRouterImports = new Set([
  "BrowserRouter",
  "Link",
  "Route",
  "Routes",
  "useLocation",
  "useNavigate",
  "useParams",
  "useSearchParams",
]);
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);

function fail(message, details = []) {
  console.error(`[production-audit] FAIL ${message}`);
  for (const detail of details) console.error(`  - ${detail}`);
  process.exit(1);
}

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(target));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(target);
  }
  return files;
}

function verifyBrowserOnlyRouterUsage() {
  const src = path.join(root, "src");
  const violations = [];
  const importPattern =
    /import\s*\{([^}]+)\}\s*from\s*["']react-router(?:-dom)?["']/g;
  const forbiddenRuntimePatterns = [
    /@react-router\/dev/,
    /createRequestHandler/,
    /createStaticHandler/,
    /HydratedRouter/,
    /RSCStaticRouter/,
    /ServerRouter/,
    /unstable_RSC/,
    /useActionData/,
    /useFetcher/,
  ];

  for (const filePath of walk(src)) {
    const source = fs.readFileSync(filePath, "utf8");
    for (const pattern of forbiddenRuntimePatterns) {
      if (pattern.test(source)) {
        violations.push(
          `${path.relative(root, filePath)} uses ${pattern.source}`,
        );
      }
    }
    for (const match of source.matchAll(importPattern)) {
      const imports = match[1]
        .split(",")
        .map((value) => value.trim().split(/\s+as\s+/)[0])
        .filter(Boolean);
      for (const imported of imports) {
        if (!allowedRouterImports.has(imported)) {
          violations.push(
            `${path.relative(root, filePath)} imports unsupported router API ${imported}`,
          );
        }
      }
    }
  }

  if (violations.length > 0) {
    fail(
      "The React Router advisory exception is no longer valid because server/action APIs are present.",
      violations,
    );
  }
}

function installedRouterVersion() {
  const packagePath = require.resolve("react-router/package.json", {
    paths: [root],
  });
  return JSON.parse(fs.readFileSync(packagePath, "utf8")).version;
}

const npmExecutable = process.env.npm_execpath;
const audit = npmExecutable
  ? spawnSync(
      process.execPath,
      [npmExecutable, "audit", "--omit=dev", "--json"],
      { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    )
  : spawnSync("npm", ["audit", "--omit=dev", "--json"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      shell: process.platform === "win32",
    });

if (!audit.stdout) {
  fail("npm audit returned no machine-readable report.", [
    audit.error?.message || audit.stderr?.trim() || "unknown npm audit failure",
  ]);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  fail("npm audit returned invalid JSON.", [audit.stdout.slice(0, 500)]);
}

const vulnerabilities = Object.values(report.vulnerabilities || {});
if (vulnerabilities.length === 0) {
  console.log("[production-audit] PASS no production vulnerabilities found");
  process.exit(0);
}

const unexpected = [];
for (const vulnerability of vulnerabilities) {
  if (vulnerability.name === "react-router-dom") {
    const onlyRouterEffect =
      Array.isArray(vulnerability.via) &&
      vulnerability.via.every((entry) => entry === "react-router");
    if (onlyRouterEffect) continue;
  }

  if (vulnerability.name !== "react-router") {
    unexpected.push(`${vulnerability.name}: ${vulnerability.severity}`);
    continue;
  }
  const advisoryEntries = (vulnerability.via || []).filter(
    (entry) => entry && typeof entry === "object",
  );
  if (
    advisoryEntries.length !== 1 ||
    advisoryEntries[0].url !== acceptedAdvisory
  ) {
    unexpected.push(
      `react-router: ${advisoryEntries.map((entry) => entry.url).join(", ") || "unknown advisory"}`,
    );
  }
}

if (unexpected.length > 0) {
  fail("Unexpected production vulnerabilities were found.", unexpected);
}

const routerVersion = installedRouterVersion();
if (routerVersion !== "7.18.2") {
  fail("The narrow React Router exception is pinned to 7.18.2.", [
    `installed version: ${routerVersion}`,
  ]);
}

verifyBrowserOnlyRouterUsage();
console.log(
  `[production-audit] PASS only ${acceptedAdvisory} remains; StudyPod is verified as a BrowserRouter-only Vite SPA with no RSC, loader/action, or server router APIs.`,
);
