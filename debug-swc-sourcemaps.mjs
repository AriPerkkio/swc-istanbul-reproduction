import { readFileSync } from "node:fs";
import path from "node:path";

import { transform } from "@swc/core";
import { JSDOM } from "jsdom";
import * as reports from "istanbul-reports";
import libCoverage from "istanbul-lib-coverage";
import { createInstrumenter } from "istanbul-lib-instrument";
import { createSourceMapStore } from "istanbul-lib-source-maps";
import { createContext } from "istanbul-lib-report";

import {
  mkdir,
  rmIfExists,
  writeCoverageRemappings,
  writeGeneratedFile,
  writeMappings,
  writeRemapping,
} from "./utils.mjs";

// Automatic breaks coverage, classic one works
const condition = !true;
const runtime = condition ? "automatic" : "classic";

// Prepare
rmIfExists("./coverage");
rmIfExists("./generated");
mkdir("./generated");
globalThis.window = new JSDOM().window;
globalThis.document = window.document;

const filename = "repro.tsx";
const sources = readFileSync(path.resolve(filename), "utf8");
console.log("");

const transpiled = await transform(sources, {
  filename,
  swcrc: false,
  configFile: false,
  sourceMaps: true,
  jsc: {
    target: "es2020",
    parser: { syntax: "typescript", tsx: true },
    transform: {
      useDefineForClassFields: true,
      react: { development: true, runtime },
    },
  },
});
transpiled.map = JSON.parse(transpiled.map);

writeGeneratedFile("transpiled.js", transpiled.code);
writeGeneratedFile("transpiled.js.map", transpiled.map);
writeMappings("transpiled", transpiled.map.mappings);
writeRemapping("transpiled", transpiled.code, transpiled.map);
console.log("");

/*
 * Instrument JavaScript with Istanbul
 */
const instrumenter = createInstrumenter({
  esModules: true,
  compact: false,
  produceSourceMap: true,
  autoWrap: false,
  coverageVariable: "__coverage__",
  coverageGlobalScope: "globalThis",
});

const instrumented = {
  code: instrumenter.instrumentSync(transpiled.code, filename, transpiled.map),
  map: instrumenter.lastSourceMap(),
};

writeGeneratedFile("instrumented.js", instrumented.code);
writeGeneratedFile("instrumented.js.map", instrumented.map);
writeMappings("instrumented", instrumented.map.mappings);
writeRemapping("instrumented", instrumented.code, instrumented.map);
console.log("");

/*
 * Run the instrumented JavaScript to get parts of code covered
 */
console.log("Running ./generated/instrumented.js");
if (runtime === "classic") {
  globalThis.React = { createElement: () => {}, Fragment: () => {} };
}
const ReactComponent = (await import("./generated/instrumented.js")).default;
ReactComponent({ total: 2 });
console.log("");

/*
 * Collect coverage from instrumented JavaScript
 */
const collectedCoverage = libCoverage.createCoverageMap(globalThis.__coverage__);
writeGeneratedFile("coverage-pre.json", collectedCoverage);
writeCoverageRemappings("transpiled", collectedCoverage.fileCoverageFor(filename), transpiled.code);

/*
 * Re-map coverage map of instrumented transpiled JavaScript back to Typescript
 */
const sourceMapStore = createSourceMapStore();
const coverageMap = await sourceMapStore.transformCoverage(collectedCoverage);
writeGeneratedFile("coverage-final.json", coverageMap);
writeCoverageRemappings("sources", coverageMap.fileCoverageFor(path.resolve(filename)), sources);

/*
 * Generate reports
 */
const context = createContext({
  coverageMap,
  sourceFinder: sourceMapStore.sourceFinder,
});
["json", "html", "text"].forEach((name) => reports.create(name).execute(context));
