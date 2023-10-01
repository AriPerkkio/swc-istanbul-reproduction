import fs from "node:fs";
import { EOL } from "node:os";

import prettier from "prettier";
import { decode } from "@jridgewell/sourcemap-codec";
import { codeFrameColumns } from "@babel/code-frame";

export function rmIfExists(dir) {
  if (fs.existsSync(dir)) {
    console.log(`rm -rf ${dir}`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function mkdir(dir) {
  console.log(`mkdir ${dir}`);
  fs.mkdirSync(dir, { recursive: true });
}

export function writeGeneratedFile(name, content) {
  console.log(`Writing ./generated/${name}`);

  fs.writeFileSync(
    `./generated/${name}`,
    typeof content === "string"
      ? content
      : prettier.format(JSON.stringify(content, null, 2), { parser: "json" }),
    "utf-8"
  );
}

export function writeMappings(namePrefix, mappings) {
  const decoded = decode(mappings);
  const withLineNumbers = Object.entries(decoded).reduce((all, [index, mapping]) => {
    if (mapping.length === 0) return all;

    return { ...all, [`Line ${1 + parseInt(index)}`]: mapping };
  }, {});

  writeGeneratedFile(`${namePrefix}.mappings.json`, withLineNumbers);
}

export function writeRemapping(namePrefix, generated, sourcemap) {
  const decodedMappings = decode(sourcemap.mappings);
  const [sources] = sourcemap.sourcesContent;
  const markdownRows = [];

  for (const [generatedRowIndex, mappings] of decodedMappings.entries()) {
    const mappingPairs = mappings.reduce((all, current, index) => {
      const pairIndex = Math.floor(index / 2);
      const entry = all[pairIndex] || [];
      entry.push(current);
      all[pairIndex] = entry;

      return all;
    }, []);

    for (const [start, end] of mappingPairs) {
      const generatedPosition = {
        start: { line: 1 + generatedRowIndex, column: 1 + start[0] },
        end: end ? { line: 1 + generatedRowIndex, column: 1 + end[0] } : undefined,
      };
      const sourcePosition = {
        start: { line: 1 + start[2], column: 1 + start[3] },
        end: end ? { line: 1 + end[2], column: 1 + end[3] } : undefined,
      };

      const generatedCodeFrame = codeFrameColumns(generated, generatedPosition);
      const sourceCodeFrame = codeFrameColumns(sources, sourcePosition);

      // prettier-ignore
      markdownRows.push(`
Source, (${sourcePosition.start.line}, ${sourcePosition.start.column})${sourcePosition.end ? ` to (${sourcePosition.end.line}, ${sourcePosition.end.column})` : ''}:
Exists in sources? ${existsInSources(sources, sourcePosition) ? 'Yes ✅' : 'No ❌'}

\`\`\`js
${sourceCodeFrame}
\`\`\`

Generated, (${generatedPosition.start.line}, ${generatedPosition.start.column})${generatedPosition.end ? ` to (${generatedPosition.end.line}, ${generatedPosition.end.column})` : ''}:

\`\`\`js
${generatedCodeFrame}
\`\`\`
`);
    }
  }

  const markdown = markdownRows
    .map((row, index) => `## ${1 + index} ${row.trim()}`)
    .join(`${EOL}${EOL}${"_".repeat(80)}${EOL}${EOL}`);

  writeGeneratedFile(`${namePrefix}.remapped.md`, markdown);
}

export function writeCoverageRemappings(namePrefix, coverageMap, code) {
  const markdownRowsWithLine = []; // { line: number, content: string }

  const { statementMap, s: statementHits } = coverageMap.data;
  for (const [key, { start, end }] of Object.entries(statementMap)) {
    const frame = codeFrameColumns(code, normalizeLocation({ start, end }));

    const content = `
Statement
Hit: ${statementHits[key] > 0 ? "Yes ✅" : "No ❌"}

\`\`\`js
${frame}
\`\`\`
`;

    markdownRowsWithLine.push({ line: start.line, content });
  }

  const { branchMap, b: branchHits } = coverageMap.data;

  for (const [key, { loc }] of Object.entries(branchMap)) {
    const { start, end } = loc;
    const frame = codeFrameColumns(code, normalizeLocation({ start, end }));

    const content = `
Branch
Hit: ${branchHits[key] > 0 ? "Yes ✅" : "No ❌"}

\`\`\`js
${frame}
\`\`\`
`;

    markdownRowsWithLine.push({ line: start.line, content });
  }

  const { fnMap, f: fnHits } = coverageMap.data;

  for (const [key, { loc }] of Object.entries(fnMap)) {
    const { start, end } = loc;
    const frame = codeFrameColumns(code, normalizeLocation({ start, end }));

    const content = `
Function
Hit: ${fnHits[key] > 0 ? "Yes ✅" : "No ❌"}

\`\`\`js
${frame}
\`\`\`
`;

    markdownRowsWithLine.push({ line: start.line, content });
  }

  const markdownRows = markdownRowsWithLine
    .sort((a, b) => a.line - b.line)
    .map((row) => row.content);

  const markdown = markdownRows
    .map((row, index) => `## ${1 + index} ${row.trim()}`)
    .join(`${EOL}${EOL}${"_".repeat(80)}${EOL}${EOL}`);

  writeGeneratedFile(`${namePrefix}.coverage-remapped.md`, markdown);
}

function existsInSources(sources, { start }) {
  const rows = sources.split(EOL);
  const startCharacter = rows[start.line - 1].charAt(start.column - 1);

  return startCharacter.length !== 0;
}

function normalizeLocation({ start, end }) {
  return {
    start: {
      ...start,
      column: start.column === Infinity ? undefined : start.column,
    },
    end: {
      ...end,
      column: end.column === Infinity ? undefined : end.column,
    },
  };
}
