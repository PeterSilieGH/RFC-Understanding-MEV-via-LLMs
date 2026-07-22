const DISALLOWED_FORMAT_CHARACTERS = /\p{Cf}/gu;

function stripTerminalControls(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index) ?? 0;
    if (codePoint === 27) {
      const introducer = value.codePointAt(index + 1);
      if (introducer === 93) {
        index += 2;
        while (index < value.length) {
          const current = value.codePointAt(index);
          if (current === 7) break;
          if (current === 27 && value.codePointAt(index + 1) === 92) {
            index += 1;
            break;
          }
          index += 1;
        }
      } else if (introducer === 91) {
        index += 2;
        while (index < value.length) {
          const current = value.codePointAt(index) ?? 0;
          if (current >= 64 && current <= 126) break;
          index += 1;
        }
      } else if (introducer !== undefined) {
        index += 1;
      }
      continue;
    }
    if (codePoint === 9 || codePoint === 10 || codePoint === 13) {
      result += value[index];
      continue;
    }
    if (codePoint < 32 || (codePoint >= 127 && codePoint <= 159)) continue;
    const character = String.fromCodePoint(codePoint);
    result += character;
    if (codePoint > 0xffff) index += 1;
  }
  return result;
}

/** Keep line breaks and tabs but remove terminal escapes and other control bytes. */
export function sanitizeText(value: string): string {
  return stripTerminalControls(value)
    .replace(DISALLOWED_FORMAT_CHARACTERS, "")
    .replace(/\r\n?/g, "\n");
}

export function sanitizeSingleLine(value: string): string {
  return sanitizeText(value)
    .replace(/[\n\t]+/g, " ")
    .trim();
}
