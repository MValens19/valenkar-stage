/**
 * Parser ligero para archivos .sfz estándar.
 * Extrae <global>, <group> y <region> con sus respectivos opcodes.
 */
export function parseSFZ(sfzText) {
  const lines = sfzText.split(/\r?\n/);
  const result = {
    global: {},
    groups: [],
  };

  let currentHeader = null;
  let currentGroup = null;
  let currentRegion = null;

  for (let rawLine of lines) {
    // Eliminar comentarios de una línea (//)
    let line = rawLine.replace(/\/\/.*$/, "").trim();
    if (!line) continue;

    // Buscar etiquetas como <global>, <group>, <region>
    const tokens = line.split(/(<[a-zA-Z]+>)/g).filter(Boolean);

    for (let token of tokens) {
      token = token.trim();
      if (!token) continue;

      if (token.startsWith("<") && token.endsWith(">")) {
        const header = token.toLowerCase();
        if (header === "<global>") {
          currentHeader = "global";
        } else if (header === "<group>") {
          currentHeader = "group";
          currentGroup = { opcodes: {}, regions: [] };
          result.groups.push(currentGroup);
          currentRegion = null;
        } else if (header === "<region>") {
          currentHeader = "region";
          currentRegion = { opcodes: {} };
          if (!currentGroup) {
            currentGroup = { opcodes: {}, regions: [] };
            result.groups.push(currentGroup);
          }
          currentGroup.regions.push(currentRegion);
        }
      } else {
        // Pares de opcode=valor
        // Usamos un regex que capture el valor completo incluyendo #, +, etc.
        // Primero manejar 'sample=' por separado ya que el valor puede tener '#'
        const sampleMatch = token.match(/(?:^|\s)sample=([^\s]+)/i);
        if (sampleMatch && currentRegion) {
          currentRegion.opcodes["sample"] = sampleMatch[1];
        }

        // Luego el resto de opcodes numéricos y de texto simple (sin # en valores)
        const pairs = token.replace(/sample=[^\s]+/i, "").match(/([a-zA-Z0-9_]+)=([^\s=]+)/g);
        if (pairs) {
          for (let pair of pairs) {
            const eqIdx = pair.indexOf("=");
            const key = pair.slice(0, eqIdx);
            const val = pair.slice(eqIdx + 1);
            const numVal = Number(val);
            const finalVal = isNaN(numVal) ? val : numVal;

            if (currentHeader === "global") {
              result.global[key] = finalVal;
            } else if (currentHeader === "group" && currentGroup && !currentRegion) {
              currentGroup.opcodes[key] = finalVal;
            } else if (currentRegion && key !== "sample") {
              currentRegion.opcodes[key] = finalVal;
            }
          }
        }
      }
    }
  }

  return result;
}
