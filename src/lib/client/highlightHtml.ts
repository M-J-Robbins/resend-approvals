export type TokenType =
  | "text"
  | "punctuation"
  | "tag"
  | "attribute"
  | "value"
  | "comment"
  | "doctype"
  | "entity";

export interface Token {
  type: TokenType;
  text: string;
}

// Their content is raw text: a "<" inside them doesn't start a tag.
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

const ENTITY = /&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/gi;

/**
 * Splits HTML into tokens for syntax highlighting. It is a forgiving scanner,
 * not a parser: anything it doesn't recognise stays plain text, and joining
 * every token's text always gives back the input exactly.
 *
 * The review UI colours the tokens with CSS highlights over the source's one
 * text node (see EmailPreview), so no markup is ever built from agent HTML.
 */
export function highlightHtml(html: string): Token[] {
  const tokens: Token[] = [];
  const push = (type: TokenType, text: string) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last?.type === type) last.text += text;
    else tokens.push({ type, text });
  };
  const pushText = (text: string) => {
    let at = 0;
    for (const m of text.matchAll(ENTITY)) {
      push("text", text.slice(at, m.index));
      push("entity", m[0]);
      at = m.index + m[0].length;
    }
    push("text", text.slice(at));
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      pushText(html.slice(i));
      break;
    }
    pushText(html.slice(i, lt));
    i = lt;

    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      const stop = end === -1 ? html.length : end + 3;
      push("comment", html.slice(i, stop));
      i = stop;
      continue;
    }

    if (/^<!doctype/i.test(html.slice(i, i + 9))) {
      const end = html.indexOf(">", i);
      const stop = end === -1 ? html.length : end + 1;
      push("doctype", html.slice(i, stop));
      i = stop;
      continue;
    }

    const open = /^<(\/?)([a-z][\w:-]*)/i.exec(html.slice(i, i + 100));
    if (!open) {
      // A lone "<" in text.
      push("text", "<");
      i += 1;
      continue;
    }
    push("punctuation", `<${open[1]}`);
    push("tag", open[2]);
    i += open[0].length;

    // Attributes up to the closing ">".
    while (i < html.length) {
      const rest = html.slice(i, i + 2000);
      const space = /^\s+/.exec(rest);
      if (space) {
        push("text", space[0]);
        i += space[0].length;
        continue;
      }
      const close = /^\/?>/.exec(rest);
      if (close) {
        push("punctuation", close[0]);
        i += close[0].length;
        break;
      }
      const attr = /^[^\s"'<>\/=]+/.exec(rest);
      if (attr) {
        push("attribute", attr[0]);
        i += attr[0].length;
        const eq = /^\s*=\s*/.exec(html.slice(i, i + 100));
        if (eq) {
          push("punctuation", eq[0]);
          i += eq[0].length;
          const quote = html[i];
          if (quote === '"' || quote === "'") {
            const end = html.indexOf(quote, i + 1);
            const stop = end === -1 ? html.length : end + 1;
            push("value", html.slice(i, stop));
            i = stop;
          } else {
            const bare = /^[^\s>]+/.exec(html.slice(i, i + 2000));
            if (bare) {
              push("value", bare[0]);
              i += bare[0].length;
            }
          }
        }
        continue;
      }
      // Anything else inside a tag (a stray quote, "/" or "<"): keep it as text.
      push("text", html[i]);
      i += 1;
    }

    // <style>, <script> and friends: everything up to their end tag is text.
    const name = open[2].toLowerCase();
    if (!open[1] && RAW_TEXT.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name}`, i);
      const stop = end === -1 ? html.length : end;
      push("text", html.slice(i, stop));
      i = stop;
    }
  }
  return tokens;
}
