/**
 * Bytebeat Console — the formula engine, with no DOM in it.
 *
 * A bytebeat is one integer expression of `t` evaluated once per sample; the
 * low byte of the result is the speaker position. The classic
 * `t*(42&t>>10)` is a whole composition in fourteen characters.
 *
 * The formula is NEVER handed to eval() or new Function(). It goes through a
 * hand-written tokenizer and a precedence-climbing parser into an AST, and the
 * AST is compiled into a tree of closures — so the only code that ever runs is
 * code in this file, whatever gets pasted into the box.
 *
 *   1. `tokenize` — characters → tokens, with a position on every error
 *   2. `parse`    — tokens → AST, C-style precedence, bounded size and depth
 *   3. `compile`  — AST → a plain (t) => number closure
 *
 * `renderSamples` turns a closure into audio floats in one of three dialects
 * (unsigned byte, signed byte, float), and `makeWav` emits a RIFF/WAVE PCM
 * file byte by byte — the whole export path is hand-rolled and testable.
 *
 * Wrapped UMD-style, like the other `*-pipeline.js` files, so
 * `tests/unit/bytebeat.pipeline.test.js` can require the same code the
 * browser loads.
 */
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BytebeatPipeline = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  // Hostile input is expected input: a pasted formula is bounded in length,
  // node count and nesting depth before a single sample is rendered.
  const MAX_SOURCE = 512;
  const MAX_NODES = 512;
  const MAX_DEPTH = 64;
  const MAX_RENDER_SECONDS = 60;
  const MAX_RENDER_SAMPLES = 48000 * MAX_RENDER_SECONDS;

  const RATES = [8000, 11025, 16000, 22050, 32000, 44100];
  const MODES = ["byte", "signed", "float"];
  const BITS = [8, 16];

  /* One-line classics from the bytebeat scene (viznut and friends, 2011) —
   * the demoscene's public one-liners, here as the preset shelf. */
  const PRESETS = [
    { name: "the forty-two melody", source: "t*(42&t>>10)", rate: 8000 },
    { name: "harmony engine", source: "(t*5&t>>7)|(t*3&t>>10)", rate: 8000 },
    { name: "dial-up choir", source: "t*((t>>12|t>>8)&63&t>>4)", rate: 8000 },
    { name: "sierpinski drone", source: "t&t>>8", rate: 8000 },
    { name: "lost in space", source: "((t*(t>>8|t>>9)&46&t>>8))^(t&t>>13|t>>6)", rate: 8000 },
    { name: "big engine", source: "(t>>7|t|t>>6)*10+4*(t&t>>13|t>>6)", rate: 44100 },
  ];

  // C-style precedence, lowest first. Ternary sits below all of these and is
  // handled separately; unary above all of them.
  const BINARY_LEVELS = [
    ["||"],
    ["&&"],
    ["|"],
    ["^"],
    ["&"],
    ["==", "!="],
    ["<", ">", "<=", ">="],
    ["<<", ">>", ">>>"],
    ["+", "-"],
    ["*", "/", "%"],
  ];

  // Longest first, so ">>>" never tokenizes as ">>" + ">".
  const OPERATORS = [">>>", ">>", "<<", "<=", ">=", "==", "!=", "&&", "||", "+", "-", "*", "/", "%", "&", "|", "^", "~", "!", "<", ">", "?", ":"];

  // ------------------------------------------------------------------ tokenize

  function failure(message, at) {
    return { ok: false, error: { message, at } };
  }

  function tokenize(source) {
    const text = String(source == null ? "" : source);

    if (text.length > MAX_SOURCE) {
      return failure(`formula longer than ${MAX_SOURCE} characters`, MAX_SOURCE);
    }

    const tokens = [];
    let at = 0;

    while (at < text.length) {
      const ch = text[at];

      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        at += 1;
        continue;
      }

      if (ch === "(" || ch === ")") {
        tokens.push({ type: ch, at });
        at += 1;
        continue;
      }

      // Hex first, so "0x2a" is one number and not 0 followed by junk.
      if (ch === "0" && (text[at + 1] === "x" || text[at + 1] === "X")) {
        const match = /^0[xX][0-9a-fA-F]+/.exec(text.slice(at));

        if (!match) return failure("broken hex literal", at);

        tokens.push({ type: "num", value: parseInt(match[0], 16), at });
        at += match[0].length;
        continue;
      }

      if (ch >= "0" && ch <= "9") {
        const match = /^\d+(\.\d+)?/.exec(text.slice(at));

        tokens.push({ type: "num", value: Number(match[0]), at });
        at += match[0].length;
        continue;
      }

      if (/[a-zA-Z_]/.test(ch)) {
        const match = /^[a-zA-Z_]\w*/.exec(text.slice(at));

        if (match[0] !== "t") {
          return failure(`unknown name "${match[0]}" — the only variable is t`, at);
        }

        tokens.push({ type: "t", at });
        at += 1;
        continue;
      }

      let matched = null;

      for (let i = 0; i < OPERATORS.length; i += 1) {
        if (text.startsWith(OPERATORS[i], at)) {
          matched = OPERATORS[i];
          break;
        }
      }

      if (!matched) return failure(`unexpected character "${ch}"`, at);

      tokens.push({ type: "op", op: matched, at });
      at += matched.length;
    }

    return { ok: true, tokens };
  }

  // --------------------------------------------------------------------- parse

  function parse(tokens) {
    let at = 0;
    let nodes = 0;

    function peek() {
      return tokens[at] || null;
    }

    function peekOp(ops) {
      const token = peek();

      return token && token.type === "op" && ops.indexOf(token.op) !== -1 ? token.op : null;
    }

    function node(shape) {
      nodes += 1;

      if (nodes > MAX_NODES) throw { message: `formula has more than ${MAX_NODES} operations`, at: 0 };

      return shape;
    }

    function parseTernary(depth) {
      const cond = parseBinary(0, depth);

      if (peekOp(["?"])) {
        at += 1;

        const then = parseTernary(depth + 1);
        const colon = peek();

        if (!colon || colon.type !== "op" || colon.op !== ":") {
          throw { message: "ternary is missing its :", at: colon ? colon.at : sourceEnd() };
        }

        at += 1;

        return node({ op: "?:", cond, a: then, b: parseTernary(depth + 1) });
      }

      return cond;
    }

    function parseBinary(level, depth) {
      if (depth > MAX_DEPTH) throw { message: "formula nests too deep", at: peek() ? peek().at : 0 };
      if (level === BINARY_LEVELS.length) return parseUnary(depth);

      let left = parseBinary(level + 1, depth);
      let op = peekOp(BINARY_LEVELS[level]);

      while (op) {
        at += 1;
        left = node({ op, a: left, b: parseBinary(level + 1, depth + 1) });
        op = peekOp(BINARY_LEVELS[level]);
      }

      return left;
    }

    function parseUnary(depth) {
      if (depth > MAX_DEPTH) throw { message: "formula nests too deep", at: peek() ? peek().at : 0 };

      const op = peekOp(["-", "~", "!", "+"]);

      if (op) {
        at += 1;

        return node({ op: `u${op}`, a: parseUnary(depth + 1) });
      }

      return parsePrimary(depth);
    }

    function parsePrimary(depth) {
      const token = peek();

      if (!token) throw { message: "formula ends mid-expression", at: sourceEnd() };

      if (token.type === "num") {
        at += 1;
        return node({ op: "num", value: token.value });
      }

      if (token.type === "t") {
        at += 1;
        return node({ op: "t" });
      }

      if (token.type === "(") {
        at += 1;

        const inner = parseTernary(depth + 1);
        const closing = peek();

        if (!closing || closing.type !== ")") {
          throw { message: "missing a closing )", at: closing ? closing.at : sourceEnd() };
        }

        at += 1;
        return inner;
      }

      throw { message: `unexpected "${token.op || token.type}"`, at: token.at };
    }

    function sourceEnd() {
      return tokens.length > 0 ? tokens[tokens.length - 1].at + 1 : 0;
    }

    if (tokens.length === 0) return failure("the formula is empty", 0);

    try {
      const ast = parseTernary(0);
      const leftover = peek();

      if (leftover) {
        return failure(`unexpected "${leftover.op || leftover.type}" after the expression`, leftover.at);
      }

      return { ok: true, ast };
    } catch (error) {
      return failure(error.message || "unparseable formula", error.at || 0);
    }
  }

  // ------------------------------------------------------------------- compile

  /* AST → closure tree. Semantics are JavaScript's: bit operations coerce to
   * 32-bit, comparisons yield 1/0, && and || are short-circuiting and numeric.
   * A division by zero is allowed to produce Infinity here — the sample stage
   * masks or clamps whatever comes out. */
  function compileNode(n) {
    switch (n.op) {
      case "num": {
        const value = n.value;

        return function () {
          return value;
        };
      }
      case "t":
        return function (t) {
          return t;
        };
      case "?:": {
        const cond = compileNode(n.cond);
        const a = compileNode(n.a);
        const b = compileNode(n.b);

        return function (t) {
          return cond(t) ? a(t) : b(t);
        };
      }
      default: {
        const a = compileNode(n.a);
        const b = n.b ? compileNode(n.b) : null;

        switch (n.op) {
          case "||":
            return function (t) {
              const av = a(t);

              return av ? av : b(t);
            };
          case "&&":
            return function (t) {
              const av = a(t);

              return av ? b(t) : av;
            };
          case "|":
            return function (t) {
              return a(t) | b(t);
            };
          case "^":
            return function (t) {
              return a(t) ^ b(t);
            };
          case "&":
            return function (t) {
              return a(t) & b(t);
            };
          case "==":
            return function (t) {
              return a(t) === b(t) ? 1 : 0;
            };
          case "!=":
            return function (t) {
              return a(t) !== b(t) ? 1 : 0;
            };
          case "<":
            return function (t) {
              return a(t) < b(t) ? 1 : 0;
            };
          case ">":
            return function (t) {
              return a(t) > b(t) ? 1 : 0;
            };
          case "<=":
            return function (t) {
              return a(t) <= b(t) ? 1 : 0;
            };
          case ">=":
            return function (t) {
              return a(t) >= b(t) ? 1 : 0;
            };
          case "<<":
            return function (t) {
              return a(t) << b(t);
            };
          case ">>":
            return function (t) {
              return a(t) >> b(t);
            };
          case ">>>":
            return function (t) {
              return a(t) >>> b(t);
            };
          case "+":
            return function (t) {
              return a(t) + b(t);
            };
          case "-":
            return function (t) {
              return a(t) - b(t);
            };
          case "*":
            return function (t) {
              return a(t) * b(t);
            };
          case "/":
            return function (t) {
              return a(t) / b(t);
            };
          case "%":
            return function (t) {
              return a(t) % b(t);
            };
          case "u-":
            return function (t) {
              return -a(t);
            };
          case "u+":
            return function (t) {
              return +a(t);
            };
          case "u~":
            return function (t) {
              return ~a(t);
            };
          case "u!":
            return function (t) {
              return a(t) ? 0 : 1;
            };
          default:
            throw new Error(`unreachable operator ${n.op}`);
        }
      }
    }
  }

  function compile(source) {
    const tokenized = tokenize(source);

    if (!tokenized.ok) return tokenized;

    const parsed = parse(tokenized.tokens);

    if (!parsed.ok) return parsed;

    return { ok: true, fn: compileNode(parsed.ast), source: String(source) };
  }

  // -------------------------------------------------------------------- render

  /* One raw value → one float in [-1, 1], per dialect. `& 255` doubles as the
   * NaN/Infinity trap: JavaScript coerces both to 0 before masking. */
  function toFloat(value, mode) {
    if (mode === "float") {
      if (!Number.isFinite(value)) return 0;

      return value < -1 ? -1 : value > 1 ? 1 : value;
    }

    if (mode === "signed") {
      return (((value & 255) << 24) >> 24) / 128;
    }

    return (value & 255) / 127.5 - 1;
  }

  function renderSamples(fn, options) {
    const opts = options || {};
    const mode = MODES.indexOf(opts.mode) === -1 ? "byte" : opts.mode;
    const from = Math.max(0, Math.floor(Number(opts.from) || 0));
    const count = Math.max(0, Math.min(MAX_RENDER_SAMPLES, Math.floor(Number(opts.count) || 0)));
    const samples = new Float32Array(count);
    let min = count > 0 ? Infinity : 0;
    let max = count > 0 ? -Infinity : 0;
    let clipped = 0;

    for (let i = 0; i < count; i += 1) {
      const raw = fn(from + i);
      const value = toFloat(raw, mode);

      if (mode === "float" && (!Number.isFinite(raw) || raw < -1 || raw > 1)) clipped += 1;

      samples[i] = value;

      if (value < min) min = value;
      if (value > max) max = value;
    }

    return { samples, min, max, clipped, mode, from };
  }

  // ----------------------------------------------------------------------- WAV

  /* Minimal RIFF/WAVE writer: mono PCM, 8-bit unsigned or 16-bit signed
   * little-endian. 44 header bytes written by hand — that is the whole point. */
  function makeWav(samples, options) {
    const opts = options || {};
    const rate = RATES.indexOf(Number(opts.rate)) === -1 ? 8000 : Number(opts.rate);
    const bits = BITS.indexOf(Number(opts.bits)) === -1 ? 8 : Number(opts.bits);
    const bytesPerSample = bits / 8;
    const dataLength = samples.length * bytesPerSample;
    const bytes = new Uint8Array(44 + dataLength);
    let at = 0;

    function ascii(text) {
      for (let i = 0; i < text.length; i += 1) bytes[at++] = text.charCodeAt(i);
    }

    function u32(value) {
      bytes[at++] = value & 255;
      bytes[at++] = (value >>> 8) & 255;
      bytes[at++] = (value >>> 16) & 255;
      bytes[at++] = (value >>> 24) & 255;
    }

    function u16(value) {
      bytes[at++] = value & 255;
      bytes[at++] = (value >>> 8) & 255;
    }

    ascii("RIFF");
    u32(36 + dataLength);
    ascii("WAVE");
    ascii("fmt ");
    u32(16); // PCM fmt chunk size
    u16(1); // audio format: PCM
    u16(1); // channels: mono
    u32(rate);
    u32(rate * bytesPerSample); // byte rate
    u16(bytesPerSample); // block align
    u16(bits);
    ascii("data");
    u32(dataLength);

    for (let i = 0; i < samples.length; i += 1) {
      const s = samples[i] < -1 ? -1 : samples[i] > 1 ? 1 : samples[i];

      if (bits === 8) {
        bytes[at++] = Math.round((s + 1) * 127.5);
      } else {
        const v = Math.round(s * 32767);

        bytes[at++] = v & 255;
        bytes[at++] = (v >>> 8) & 255;
      }
    }

    return bytes;
  }

  return {
    MAX_SOURCE,
    MAX_NODES,
    MAX_DEPTH,
    MAX_RENDER_SECONDS,
    MAX_RENDER_SAMPLES,
    RATES,
    MODES,
    BITS,
    PRESETS,
    tokenize,
    parse,
    compile,
    toFloat,
    renderSamples,
    makeWav,
  };
});
