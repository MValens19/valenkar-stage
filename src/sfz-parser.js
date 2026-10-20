function stripComments(line, inBlockComment) {
  let output = "";
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      output += char;
      if (char === quote && line[i - 1] !== "\\") quote = "";
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      output += char;
    } else if (
      char === "/" &&
      next === "/" &&
      (output.trim() === "" || /\s$/.test(output))
    ) {
      break;
    } else if (char === "/" && next === "*") {
      inBlockComment = true;
      i++;
    } else {
      output += char;
    }
  }
  return { line: output, inBlockComment };
}

function parseOpcodeValue(value) {
  const unquoted = value.replace(/^(['"])(.*)\1$/, "$2");
  const number = Number(unquoted);
  return unquoted !== "" && Number.isFinite(number) ? number : unquoted;
}

function parseOpcodes(text, target, defines) {
  const expanded = text.replace(/\$\w+/g, (name) => defines.get(name) ?? name);
  const opcode = /([a-zA-Z][a-zA-Z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/g;
  for (const match of expanded.matchAll(opcode)) {
    target[match[1].toLowerCase()] = parseOpcodeValue(match[2]);
  }
}

/**
 * Parses common SFZ 1.x/2.x section and opcode syntax.
 * Includes must be resolved before parsing; macro definitions are expanded here.
 */
export function parseSFZ(sfzText) {
  const lines = [];
  let inBlockComment = false;
  for (const rawLine of sfzText.split(/\r?\n/)) {
    const cleaned = stripComments(rawLine, inBlockComment);
    inBlockComment = cleaned.inBlockComment;
    lines.push(cleaned.line.trim());
  }

  const defines = new Map();
  const sourceLines = [];
  for (const line of lines) {
    const define = line.match(/^#define\s+(\$\w+)\s+(.+)$/i);
    if (define) {
      defines.set(define[1], define[2].trim().replace(/^(['"])(.*)\1$/, "$2"));
    } else if (/^\s*#include\b/i.test(line)) {
      throw new Error("El SFZ contiene #include sin resolver.");
    } else if (!line.startsWith("#")) {
      sourceLines.push(line);
    }
  }

  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (const [name, value] of defines) {
      const expanded = value.replace(/\$\w+/g, (token) => defines.get(token) ?? token);
      if (expanded !== value) {
        defines.set(name, expanded);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const result = { master: {}, global: {}, groups: [] };
  let scope = null;
  let currentGroup = null;
  let currentRegion = null;

  const processText = (text) => {
    const sections = text.split(/(<[^>]+>)/g);
    for (const section of sections) {
      const header = section.match(/^<\s*([^>]+)\s*>$/);
      if (header) {
        const name = header[1].trim().toLowerCase();
        currentRegion = null;
        if (name === "master") {
          scope = result.master;
        } else if (name === "global") {
          scope = result.global;
        } else if (name === "group") {
          currentGroup = { opcodes: {}, regions: [] };
          result.groups.push(currentGroup);
          scope = currentGroup.opcodes;
        } else if (name === "region") {
          if (!currentGroup) {
            currentGroup = { opcodes: {}, regions: [] };
            result.groups.push(currentGroup);
          }
          currentRegion = { opcodes: {} };
          currentGroup.regions.push(currentRegion);
          scope = currentRegion.opcodes;
        } else {
          scope = null;
          currentGroup = null;
        }
      } else if (scope) {
        parseOpcodes(section, scope, defines);
      }
    }
  };

  for (const line of sourceLines) processText(line);
  return result;
}
