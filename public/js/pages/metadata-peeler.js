/* Hidden operator page: /operator/tools/metadata-peeler
 *
 * Takes a local JPEG/PNG/GIF, walks its container byte by byte, and shows what
 * the file says about whoever made it. No image library, no server round-trip:
 * the bytes are read with the File API, parsed in this tab, and thrown away when
 * the page closes. Coordinates lifted out of a photo are printed here and
 * nowhere else — there is no endpoint behind this page to send them to.
 *
 * This file is the console — file intake, block list, hex panel, EXIF tables,
 * download. The parsing lives in `metadata-peeler-pipeline.js`, which has no DOM
 * in it and is unit-tested directly. What stays here is the work that needs a
 * document: rendering, and turning the stripped buffer into a saved file.
 *
 * The raw bytes are held for the life of the file, so re-peeling with different
 * toggles never re-reads the disk and never re-parses: `previewStrip` recomputes
 * the readouts from the block list alone, which is why the toggles feel live.
 *
 * Every string rendered here comes out of somebody's file. All of it goes in via
 * `textContent`; a comment field containing markup is a payload, not a surprise.
 *
 * Vanilla IIFE, matching the other page scripts in this directory. */
(function () {
  "use strict";

  const pipeline = window.MetadataPeelerPipeline;

  const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/gif"];
  const ACCEPTED_EXTENSIONS = /\.(jpe?g|png|gif)$/i;

  // Parsing is a walk over a few hundred headers, not over the pixels, so the
  // cap is about the size of the ArrayBuffer rather than about the work.
  const MAX_BYTES = 24 * 1024 * 1024;

  const THEMES = ["cyan", "amber", "lime", "magenta", "ice"];
  const THEME_KEY = "mdp-theme";

  const EXTENSIONS = { jpeg: "jpg", png: "png", gif: "gif" };
  const MIME = { jpeg: "image/jpeg", png: "image/png", gif: "image/gif" };

  const LEVEL_ORDER = { high: 3, warn: 2, info: 1, clean: 0 };

  const el = {
    state: document.getElementById("mdpState"),
    theme: document.getElementById("mdpTheme"),
    drop: document.getElementById("mdpDrop"),
    file: document.getElementById("mdpFile"),
    message: document.getElementById("mdpMessage"),
    fileName: document.getElementById("mdpFileName"),
    format: document.getElementById("mdpFormat"),
    fileSize: document.getElementById("mdpFileSize"),
    blockTotal: document.getElementById("mdpBlockTotal"),
    metaBytes: document.getElementById("mdpMetaBytes"),
    elapsed: document.getElementById("mdpElapsed"),
    peel: document.getElementById("mdpPeel"),
    report: document.getElementById("mdpReport"),
    clear: document.getElementById("mdpClear"),
    riskTag: document.getElementById("mdpRiskTag"),
    findings: document.getElementById("mdpFindings"),
    findingsEmpty: document.getElementById("mdpFindingsEmpty"),
    frames: document.getElementById("mdpFrames"),
    preview: document.getElementById("mdpPreview"),
    thumbFrame: document.getElementById("mdpThumbFrame"),
    thumb: document.getElementById("mdpThumb"),
    thumbCaption: document.getElementById("mdpThumbCaption"),
    controls: document.getElementById("mdpControls"),
    beforeBytes: document.getElementById("mdpBeforeBytes"),
    afterBytes: document.getElementById("mdpAfterBytes"),
    savedBytes: document.getElementById("mdpSavedBytes"),
    dropCount: document.getElementById("mdpDropCount"),
    selectAll: document.getElementById("mdpSelectAll"),
    selectNone: document.getElementById("mdpSelectNone"),
    reset: document.getElementById("mdpReset"),
    hexRows: document.getElementById("mdpHexRows"),
    hexScope: document.getElementById("mdpHexScope"),
    warnings: document.getElementById("mdpWarnings"),
    blocks: document.getElementById("mdpBlocks"),
    blocksEmpty: document.getElementById("mdpBlocksEmpty"),
    blocksTag: document.getElementById("mdpBlocksTag"),
    detailTag: document.getElementById("mdpDetailTag"),
    detailTitle: document.getElementById("mdpDetailTitle"),
    detailFields: document.getElementById("mdpDetailFields"),
    hex: document.getElementById("mdpHex"),
    exif: document.getElementById("mdpExif"),
    exifEmpty: document.getElementById("mdpExifEmpty"),
    exifTag: document.getElementById("mdpExifTag"),
  };

  const toggles = Array.prototype.slice.call(el.controls.querySelectorAll("[data-mdp-strip]"));

  // The file survives until it is ejected, so a toggle never re-reads the disk.
  let loaded = null; // { name, type, size, bytes }
  let parsed = null;
  let findings = [];
  let summary = null;
  let selected = -1;
  let previewUrl = null;
  let thumbUrl = null;

  // -------------------------------------------------------------------- chrome

  function setState(text, kind) {
    if (!el.state) return;

    el.state.textContent = text;
    el.state.classList.toggle("is-busy", kind === "busy");
    el.state.classList.toggle("is-error", kind === "error");
  }

  function setMessage(text, kind) {
    if (!el.message) return;

    el.message.textContent = text || "";
    el.message.classList.toggle("is-error", kind === "error");
  }

  function applyTheme(name) {
    const theme = THEMES.indexOf(name) === -1 ? THEMES[0] : name;

    document.documentElement.setAttribute("data-mdp-theme", theme);
    if (el.theme) el.theme.value = theme;

    // Private-mode Safari throws on localStorage; a theme is not worth a crash.
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      /* ignore */
    }
  }

  function restoreTheme() {
    let stored = null;

    try {
      stored = window.localStorage.getItem(THEME_KEY);
    } catch (error) {
      /* ignore */
    }

    applyTheme(stored || THEMES[0]);
  }

  // ---------------------------------------------------------------- DOM helpers

  function node(tag, className, text) {
    const element = document.createElement(tag);

    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);

    return element;
  }

  function clear(container) {
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  function readoutRow(label, value) {
    const row = node("div", "mdp-readout__row");

    row.appendChild(node("dt", null, label));
    row.appendChild(node("dd", null, value));

    return row;
  }

  function hexOffset(value) {
    return `0x${value.toString(16).toUpperCase().padStart(6, "0")}`;
  }

  // ------------------------------------------------------------------ selection

  function selection() {
    const chosen = {};

    toggles.forEach(function (toggle) {
      chosen[toggle.getAttribute("data-mdp-strip")] = toggle.checked;
    });

    return chosen;
  }

  function setSelection(mode) {
    toggles.forEach(function (toggle) {
      if (mode === "all") toggle.checked = true;
      else if (mode === "none") toggle.checked = false;
      else toggle.checked = toggle.hasAttribute("checked");
    });

    syncStrip();
  }

  /* Would the current selection drop this block? The same question the pipeline
   * asks, asked again here so the list can strike a row through before anything
   * is written. */
  function isDropped(block, chosen) {
    return !block.essential && block.strip !== null && chosen[block.strip] === true;
  }

  /* Recompute the result readouts and re-mark the block list. Cheap by design:
   * no re-parse, no buffer, just a walk over the block list. */
  function syncStrip() {
    if (!parsed) return;

    const chosen = selection();
    const preview = pipeline.previewStrip(parsed, chosen);

    el.beforeBytes.textContent = pipeline.formatBytes(preview.before);
    el.afterBytes.textContent = pipeline.formatBytes(preview.after);
    el.savedBytes.textContent = preview.removedBytes
      ? `${pipeline.formatBytes(preview.removedBytes)} · ${(preview.share * 100).toFixed(1)}%`
      : "nothing";
    el.dropCount.textContent = `${preview.removedCount} of ${summary.metadataBlocks}`;

    Array.prototype.forEach.call(el.blocks.children, function (row) {
      const block = parsed.blocks[Number(row.getAttribute("data-index"))];

      row.classList.toggle("is-dropped", isDropped(block, chosen));
    });

    el.peel.disabled = preview.removedCount === 0;
  }

  // -------------------------------------------------------------------- render

  function renderFindings() {
    clear(el.findings);

    let worst = "clean";

    findings.forEach(function (item) {
      const row = node("li", `mdp-finding mdp-finding--${item.level}`);

      row.appendChild(node("span", "mdp-finding__level", item.level));

      const body = node("div", "mdp-finding__body");

      body.appendChild(node("strong", "mdp-finding__label", item.label));
      body.appendChild(node("span", "mdp-finding__detail", item.detail));
      row.appendChild(body);
      el.findings.appendChild(row);

      if (LEVEL_ORDER[item.level] > LEVEL_ORDER[worst]) worst = item.level;
    });

    el.findingsEmpty.hidden = findings.length > 0;
    el.riskTag.textContent = worst === "clean" ? "clean" : `${findings.length} findings · ${worst}`;
    el.riskTag.className = `mdp-panel__tag mdp-panel__tag--${worst}`;
  }

  function renderBlocks() {
    clear(el.blocks);

    parsed.blocks.forEach(function (block, index) {
      const row = node("button", "mdp-block");

      row.type = "button";
      row.setAttribute("aria-pressed", "false");
      row.setAttribute("data-index", String(index));

      row.appendChild(node("span", "mdp-block__offset", hexOffset(block.offset)));
      row.appendChild(node("span", "mdp-block__label", block.label));
      row.appendChild(node("span", "mdp-block__detail", block.detail));
      row.appendChild(node("span", "mdp-block__size", pipeline.formatBytes(block.length)));
      row.appendChild(node("span", "mdp-block__flag", block.essential ? "keep" : block.strip));

      if (block.essential) row.classList.add("is-essential");
      if (block.warning) row.classList.add("is-warning");

      el.blocks.appendChild(row);
    });

    el.blocksEmpty.hidden = parsed.blocks.length > 0;
    el.blocksTag.textContent = `${parsed.blocks.length} blocks`;
  }

  function renderDetail() {
    clear(el.detailFields);

    if (selected < 0 || !parsed || !parsed.blocks[selected]) {
      el.detailTitle.textContent = "—";
      el.detailTag.textContent = "—";
      el.hex.textContent = "select a block to dump its bytes";
      return;
    }

    const block = parsed.blocks[selected];

    el.detailTitle.textContent = block.label;
    el.detailTag.textContent = block.essential ? "essential" : `strip: ${block.strip}`;

    el.detailFields.appendChild(readoutRow("Offset", `${hexOffset(block.offset)} · ${block.offset}`));
    el.detailFields.appendChild(readoutRow("Length", `${pipeline.formatBytes(block.length)} · ${block.length} B`));
    el.detailFields.appendChild(readoutRow("Kind", block.kind));
    if (block.code) el.detailFields.appendChild(readoutRow("Marker", block.code));
    if (block.detail) el.detailFields.appendChild(readoutRow("Note", block.detail));
    if (block.warning) el.detailFields.appendChild(readoutRow("Warning", block.warning));

    block.fields.forEach(function (field) {
      el.detailFields.appendChild(readoutRow(field.name, field.value));
    });

    renderHex(block);
  }

  function renderHex(block) {
    const wholeBlock = el.hexScope.value === "block";
    const from = wholeBlock ? block.offset : block.dataOffset;
    const length = wholeBlock ? block.length : block.dataLength;
    const dump = pipeline.hexDump(loaded.bytes, from, length, Number(el.hexRows.value));

    const lines = dump.rows.map(function (row) {
      return `${row.label}  ${row.hex.padEnd(47, " ")}  |${row.ascii}|`;
    });

    if (!lines.length) lines.push("(no payload)");
    else if (dump.shown < dump.total) lines.push(`… ${dump.total - dump.shown} more bytes`);

    el.hex.textContent = lines.join("\n");
  }

  function renderExif() {
    clear(el.exif);

    if (!parsed.exif) {
      el.exifEmpty.hidden = false;
      el.exifEmpty.textContent = parsed.exifError || "no TIFF directories in this file";
      el.exifTag.textContent = "no EXIF block";
      return;
    }

    el.exifEmpty.hidden = true;
    el.exifTag.textContent = `${parsed.exif.byteOrder} · ${parsed.exif.entryCount} entries`;

    parsed.exif.ifds.forEach(function (ifd) {
      const group = node("div", "mdp-ifd");
      const head = node("h3", "mdp-ifd__name", ifd.name);

      head.appendChild(node("span", "mdp-ifd__offset", ` @ ${hexOffset(ifd.offset)}`));
      group.appendChild(head);

      const table = node("table", "mdp-tags");
      const body = node("tbody");

      ifd.entries.forEach(function (entry) {
        const row = node("tr");

        row.appendChild(node("td", "mdp-tags__name", entry.name));
        row.appendChild(node("td", "mdp-tags__type", `${entry.typeName}[${entry.count}]`));
        row.appendChild(node("td", "mdp-tags__value", entry.display));
        body.appendChild(row);
      });

      table.appendChild(body);
      group.appendChild(table);
      el.exif.appendChild(group);
    });
  }

  /* The visible image beside the thumbnail its own EXIF carries. Two <img>
   * elements are the whole argument for the "embedded thumbnail" finding: when
   * they disagree, the file is still holding the frame somebody cropped away. */
  function renderFrames() {
    revokeUrls();

    previewUrl = URL.createObjectURL(new Blob([loaded.bytes], { type: MIME[parsed.format] || loaded.type }));
    el.preview.src = previewUrl;
    el.frames.hidden = false;

    const thumbnail = pipeline.extractThumbnail(loaded.bytes, parsed.exif);

    // A handler left over from the previous file would relabel this one.
    el.thumb.onload = null;

    if (!thumbnail) {
      el.thumbFrame.hidden = true;
      el.thumb.removeAttribute("src");
      return;
    }

    // The thumbnail's own dimensions are the tell: a 4:3 thumbnail on a square
    // image is the shape somebody cropped away. They arrive with the decode, so
    // the caption starts with the byte count and grows.
    el.thumb.onload = function () {
      el.thumbCaption.textContent =
        `embedded thumbnail · ${el.thumb.naturalWidth} × ${el.thumb.naturalHeight} · ` + pipeline.formatBytes(thumbnail.length);
    };

    thumbUrl = URL.createObjectURL(new Blob([thumbnail], { type: "image/jpeg" }));
    el.thumb.src = thumbUrl;
    el.thumbFrame.hidden = false;
    el.thumbCaption.textContent = `embedded thumbnail · ${pipeline.formatBytes(thumbnail.length)}`;
  }

  function renderWarnings() {
    el.warnings.textContent = parsed.warnings.length ? parsed.warnings.join(" ") : "";
    el.warnings.classList.toggle("is-error", parsed.warnings.length > 0);
  }

  // -------------------------------------------------------------------- analyse

  function analyse() {
    const startedAt = performance.now();

    parsed = pipeline.parseFile(loaded.bytes, loaded.name);

    if (!parsed.ok) {
      reject(parsed.warnings[0] || "That file is not a JPEG, PNG or GIF.");
      parsed = null;
      return;
    }

    summary = pipeline.summarise(parsed);
    findings = pipeline.auditFindings(parsed);

    const elapsed = performance.now() - startedAt;

    el.fileName.textContent = loaded.name;
    el.format.textContent = `${parsed.label}${loaded.type && MIME[parsed.format] !== loaded.type ? ` (declared ${loaded.type})` : ""}`;
    el.fileSize.textContent = `${pipeline.formatBytes(parsed.size)} · ${parsed.size} B`;
    el.blockTotal.textContent = `${summary.blocks} · ${summary.metadataBlocks} removable`;
    el.metaBytes.textContent = `${pipeline.formatBytes(summary.metadataBytes)} · ${(summary.share * 100).toFixed(1)}%`;
    el.elapsed.textContent = `${elapsed.toFixed(1)} ms`;

    selected = firstInteresting();

    renderFindings();
    renderBlocks();
    renderExif();
    renderFrames();
    renderWarnings();
    select(selected);
    syncStrip();

    el.report.disabled = false;
    el.clear.disabled = false;

    setState("ready");
    setMessage(
      summary.metadataBlocks
        ? `${summary.metadataBlocks} removable block(s) carrying ${pipeline.formatBytes(summary.metadataBytes)}.`
        : "Nothing here but the blocks the format needs.",
    );
  }

  /* Open on the block worth looking at — the first removable one, or the header
   * if the file is already clean. */
  function firstInteresting() {
    for (let i = 0; i < parsed.blocks.length; i += 1) {
      if (!parsed.blocks[i].essential) return i;
    }

    return parsed.blocks.length ? 0 : -1;
  }

  function select(index) {
    selected = index;

    Array.prototype.forEach.call(el.blocks.children, function (row) {
      const isSelected = Number(row.getAttribute("data-index")) === index;

      row.classList.toggle("is-selected", isSelected);
      row.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });

    renderDetail();
  }

  // --------------------------------------------------------------------- output

  function baseName() {
    return loaded.name.replace(/\.[^.]+$/, "") || "image";
  }

  /* Write the kept ranges out as a new file. The buffer comes back from the
   * pipeline as a copy of the original's surviving bytes, so nothing is
   * re-encoded and the download is byte-comparable against the input. */
  function peel() {
    if (!loaded || !parsed) return;

    const result = pipeline.stripMetadata(loaded.bytes, parsed, selection());
    const extension = EXTENSIONS[parsed.format] || "bin";
    const url = URL.createObjectURL(new Blob([result.bytes], { type: MIME[parsed.format] || "application/octet-stream" }));
    const link = document.createElement("a");

    link.href = url;
    link.download = `${baseName()}-peeled.${extension}`;
    link.click();

    // The click is synchronous but the fetch of the blob is not; give the
    // download a tick before pulling the URL out from under it.
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);

    setMessage(
      `Saved ${pipeline.formatBytes(result.size)} — ${result.removedCount} block(s) and ` +
        `${pipeline.formatBytes(result.removedBytes)} removed. Image data untouched.`,
    );
  }

  function copyReport() {
    if (!parsed) return;

    const text = pipeline.buildReport(parsed, findings, summary);

    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      setMessage("This browser refused clipboard access, so the report was not copied.", "error");
      return;
    }

    navigator.clipboard.writeText(text).then(
      function () {
        setMessage(`Report copied — ${text.split("\n").length} lines.`);
      },
      function () {
        setMessage("The clipboard write was refused.", "error");
      },
    );
  }

  // ---------------------------------------------------------------------- input

  function reject(message) {
    setState("rejected", "error");
    setMessage(message, "error");
  }

  function accepts(file) {
    // Chrome hands over an empty `type` for some drag sources, so fall back to
    // the extension rather than refusing a file the parser could clearly read.
    if (file.type) return ACCEPTED_TYPES.indexOf(file.type) !== -1;

    return ACCEPTED_EXTENSIONS.test(file.name || "");
  }

  function readBytes(file) {
    if (typeof file.arrayBuffer === "function") return file.arrayBuffer();

    return new Promise(function (resolve, error) {
      const reader = new FileReader();

      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        error(reader.error);
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function loadFile(file) {
    if (!file) return;

    if (!accepts(file)) {
      reject(`"${file.name || "that file"}" is not a JPEG, PNG or GIF.`);
      return;
    }

    if (file.size > MAX_BYTES) {
      reject(`${pipeline.formatBytes(file.size)} is over the ${pipeline.formatBytes(MAX_BYTES)} limit.`);
      return;
    }

    setState("reading", "busy");
    setMessage("Reading bytes…");

    readBytes(file).then(
      function (buffer) {
        loaded = {
          name: file.name || "(unnamed)",
          type: file.type || "",
          size: file.size,
          bytes: new Uint8Array(buffer),
        };

        setState("parsing", "busy");
        analyse();
      },
      function () {
        reject("That file could not be read.");
      },
    );
  }

  function revokeUrls() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);

    previewUrl = null;
    thumbUrl = null;
  }

  function clearFile() {
    revokeUrls();

    loaded = null;
    parsed = null;
    summary = null;
    findings = [];
    selected = -1;

    el.file.value = "";
    el.frames.hidden = true;
    el.thumbFrame.hidden = true;
    el.preview.removeAttribute("src");
    el.thumb.removeAttribute("src");

    clear(el.findings);
    clear(el.blocks);
    clear(el.exif);
    clear(el.detailFields);

    el.findingsEmpty.hidden = false;
    el.blocksEmpty.hidden = false;
    el.exifEmpty.hidden = false;
    el.exifEmpty.textContent = "no TIFF directories in this file";
    el.hex.textContent = "select a block to dump its bytes";
    el.warnings.textContent = "";
    el.warnings.classList.remove("is-error");

    el.peel.disabled = true;
    el.report.disabled = true;
    el.clear.disabled = true;

    [
      "fileName",
      "format",
      "fileSize",
      "blockTotal",
      "metaBytes",
      "elapsed",
      "beforeBytes",
      "afterBytes",
      "savedBytes",
      "dropCount",
      "detailTitle",
    ].forEach(function (key) {
      el[key].textContent = "—";
    });

    el.blocksTag.textContent = "block —";
    el.detailTag.textContent = "—";
    el.exifTag.textContent = "no EXIF block";
    el.riskTag.textContent = "no file";
    el.riskTag.className = "mdp-panel__tag";

    setMessage("");
    setState("idle");
  }

  // --------------------------------------------------------------------- wiring

  el.drop.addEventListener("click", function () {
    el.file.click();
  });

  el.drop.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    el.file.click();
  });

  el.file.addEventListener("change", function () {
    const picked = el.file.files && el.file.files[0];

    // Clear the input straight away: the File object above stays valid, and an
    // empty input means picking the same file twice still fires `change`.
    el.file.value = "";
    loadFile(picked);
  });

  ["dragenter", "dragover"].forEach(function (name) {
    el.drop.addEventListener(name, function (event) {
      event.preventDefault();
      el.drop.classList.add("is-hot");
    });
  });

  ["dragleave", "dragend"].forEach(function (name) {
    el.drop.addEventListener(name, function () {
      el.drop.classList.remove("is-hot");
    });
  });

  el.drop.addEventListener("drop", function (event) {
    event.preventDefault();
    el.drop.classList.remove("is-hot");
    loadFile(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
  });

  // A file dropped outside the zone would otherwise navigate away from the page.
  ["dragover", "drop"].forEach(function (name) {
    window.addEventListener(name, function (event) {
      if (el.drop.contains(event.target)) return;
      event.preventDefault();
    });
  });

  el.blocks.addEventListener("click", function (event) {
    const row = event.target.closest(".mdp-block");

    if (!row) return;

    select(Number(row.getAttribute("data-index")));
  });

  el.controls.addEventListener("change", function (event) {
    if (event.target === el.hexRows || event.target === el.hexScope) {
      renderDetail();
      return;
    }

    syncStrip();
  });

  el.controls.addEventListener("submit", function (event) {
    event.preventDefault(); // the form is a grouping device, it has nowhere to post
  });

  el.selectAll.addEventListener("click", function () {
    setSelection("all");
  });

  el.selectNone.addEventListener("click", function () {
    setSelection("none");
  });

  el.reset.addEventListener("click", function () {
    setSelection("default");
  });

  el.peel.addEventListener("click", peel);
  el.report.addEventListener("click", copyReport);
  el.clear.addEventListener("click", clearFile);

  el.theme.addEventListener("change", function () {
    applyTheme(el.theme.value);
  });

  window.addEventListener("beforeunload", revokeUrls);

  restoreTheme();
  setState("idle");
})();
