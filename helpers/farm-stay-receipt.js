/**
 * FarmStay PDF receipt generator — dependency-free, but properly designed.
 *
 * The FarmStay ecosystem is money-agnostic; charges/refunds live in Rolnopol's
 * financial service, so the guest-facing receipt is produced HERE in the app,
 * not in the gateway. To honour the "no new npm dependencies" rule we emit a
 * valid PDF 1.4 document by hand — a single A4 page with a coloured brand
 * header, a status badge, sectioned detail rows (zebra striped), a highlighted
 * total panel, and a footer. All drawing is done with primitive PDF operators
 * (filled rectangles + positioned text), no fonts beyond the two built-in
 * Helvetica faces every PDF viewer ships with.
 *
 * The document is assembled as a latin1 string so 1 char === 1 byte, which lets
 * us compute the cross-reference table's byte offsets from string lengths.
 */

const PAGE = { width: 595, height: 842 }; // A4 in PostScript points
const MARGIN = 48;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const money = (n) => round2(n).toFixed(2);

// ── Brand palette (0..1 RGB) ──────────────────────────────────────────────────
const C = {
  brand: [0.11, 0.44, 0.29],
  brandDark: [0.06, 0.3, 0.19],
  gold: [0.83, 0.63, 0.3],
  dark: [0.12, 0.16, 0.23],
  gray: [0.4, 0.45, 0.53],
  zebra: [0.96, 0.97, 0.98],
  totalBg: [0.9, 0.96, 0.92],
  white: [1, 1, 1],
  headerSub: [0.85, 0.93, 0.87],
  footRule: [0.85, 0.87, 0.9],
};

const STATE_COLOR = {
  completed: C.brand,
  confirmed: [0.15, 0.39, 0.92],
  hold: [0.85, 0.47, 0.02],
  cancelled: [0.86, 0.15, 0.15],
  expired: [0.42, 0.45, 0.5],
};

/** Drop anything outside latin1 so byte length === string length. */
function toLatin1(s) {
  return String(s == null ? "" : s).replace(/[^\x00-\xff]/g, "?");
}

/** Escape the three characters that are special inside a PDF text string. */
function escapePdfText(s) {
  return toLatin1(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * A tiny drawing surface that appends PDF content-stream operators. Coordinates
 * are PDF-native (origin bottom-left, y grows up). Colour is set immediately
 * before each mark so there is no leaking graphics state to reason about.
 */
function surface() {
  const ops = [];
  const rgb = ([r, g, b]) => `${r} ${g} ${b}`;
  // Rough Helvetica advance width (em fraction) — good enough for right-align.
  const widthOf = (str, size, bold) => toLatin1(str).length * size * (bold ? 0.58 : 0.5);

  const api = {
    rect(x, y, w, h, color) {
      ops.push(`${rgb(color)} rg\n${x} ${y} ${w} ${h} re f\n`);
      return api;
    },
    line(x1, y1, x2, y2, color, width = 1) {
      ops.push(`${width} w ${rgb(color)} RG\n${x1} ${y1} m ${x2} ${y2} l S\n`);
      return api;
    },
    text(x, y, str, { size = 11, bold = false, color = C.dark } = {}) {
      ops.push(`${rgb(color)} rg\nBT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${escapePdfText(str)}) Tj ET\n`);
      return api;
    },
    textRight(xRight, y, str, opt = {}) {
      return api.text(xRight - widthOf(str, opt.size || 11, opt.bold), y, str, opt);
    },
    build: () => ops.join(""),
  };
  return api;
}

/** Assemble numbered objects into a valid PDF file (Buffer). */
function assemblePdf(objectBodies) {
  let body = "%PDF-1.4\n";
  const offsets = [];
  objectBodies.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = body.length;
  const size = objectBodies.length + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, "latin1");
}

/** Wrap a content stream into a single-page PDF with two Helvetica faces. */
function buildDocument(content) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
      "/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  return assemblePdf(objects);
}

/** Nights in a half-open [from, to) date range. */
function nights(from, to) {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/**
 * Build a FarmStay booking receipt PDF.
 *
 * @param {object} args
 * @param {object} args.booking    reservation booking (snake_case gateway shape)
 * @param {number} [args.charged]  total debited from the guest (ROL)
 * @param {number} [args.refunded] total refunded to the guest (ROL)
 * @param {string} [args.guest]    guest identity (falls back to booking.guest_id)
 * @param {string} [args.issuedAt] ISO timestamp; defaults to now
 * @returns {Buffer} the PDF bytes
 */
function buildReceiptPdf({ booking = {}, charged = 0, refunded = 0, guest, issuedAt } = {}) {
  const b = booking;
  const n = nights(b.from, b.to);
  const total = b.quote_total || 0;
  const net = round2(charged - refunded);
  const issued = issuedAt || new Date().toISOString();
  const issuedNice = `${issued.slice(0, 19).replace("T", " ")} UTC`;

  const { width: W, height: H } = PAGE;
  const L = MARGIN;
  const R = W - MARGIN;
  const s = surface();

  // Top gold accent + brand header band.
  s.rect(0, H - 5, W, 5, C.gold);
  s.rect(0, H - 118, W, 113, C.brand);
  s.text(L, H - 62, "FarmStay", { size: 30, bold: true, color: C.white });
  s.text(L, H - 90, "Sleep among the fields - farm-stays across Poland", { size: 10.5, color: C.headerSub });
  s.textRight(R, H - 52, "RECEIPT", { size: 14, bold: true, color: C.white });
  s.textRight(R, H - 74, `No. FS-${b.id || "-"}`, { size: 11, color: C.headerSub });
  s.textRight(R, H - 92, issuedNice, { size: 9, color: C.headerSub });

  let y = H - 152;

  // Status badge + guest line.
  const state = b.state || "-";
  const badgeColor = STATE_COLOR[state] || C.gray;
  const badgeText = state.toUpperCase();
  const badgeW = toLatin1(badgeText).length * 9 * 0.62 + 22;
  s.rect(L, y - 5, badgeW, 21, badgeColor);
  s.text(L + 11, y + 1, badgeText, { size: 9, bold: true, color: C.white });
  s.text(L + badgeW + 14, y + 1, `Guest: ${guest || b.guest_id || "-"}`, { size: 10.5, color: C.gray });
  y -= 44;

  const section = (title) => {
    s.text(L, y, title, { size: 13, bold: true, color: C.brandDark });
    s.rect(L, y - 7, 42, 2.5, C.gold);
    y -= 26;
  };

  let rowIndex = 0;
  const row = (label, value, { strong = false } = {}) => {
    if (rowIndex % 2 === 0) s.rect(L - 6, y - 6, R - L + 12, 22, C.zebra);
    s.text(L, y, label, { size: 10.5, color: C.gray });
    s.textRight(R, y, value, { size: 11, bold: strong, color: C.dark });
    y -= 22;
    rowIndex += 1;
  };

  section("Stay details");
  rowIndex = 0;
  row("Property", b.property_id || "-");
  row("Check-in", b.from || "-");
  row("Check-out", b.to || "-");
  row("Nights", String(n));
  row("Guests", String(b.guests || 1));
  if (b.policy) row("Cancellation policy", String(b.policy));

  y -= 14;
  section("Payment (ROL)");
  rowIndex = 0;
  row("Booking total", money(total));
  row("Amount charged", money(charged));
  if (refunded > 0) row("Refunded", `- ${money(refunded)}`);

  // Highlighted net-paid panel.
  y -= 6;
  s.rect(L, y - 30, R - L, 42, C.totalBg);
  s.rect(L, y - 30, 4, 42, C.brand); // left accent bar
  s.text(L + 16, y - 6, "NET PAID", { size: 11, bold: true, color: C.brandDark });
  s.textRight(R - 16, y - 10, `${money(net)} ROL`, { size: 20, bold: true, color: C.brandDark });
  y -= 62;

  // Footer.
  s.line(L, 96, R, 96, C.footRule, 1);
  s.text(L, 78, "Thank you for staying with FarmStay.", { size: 10, color: C.gray });
  s.text(L, 63, "This is a system-generated receipt - no signature required.", { size: 9, color: C.gray });
  s.textRight(R, 63, "farmstay.rolnopol", { size: 9, bold: true, color: C.gold });

  return buildDocument(s.build());
}

module.exports = { buildReceiptPdf, buildDocument, _internals: { assemblePdf, nights, surface } };
