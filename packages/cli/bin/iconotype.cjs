#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/cli.ts
var cli_exports = {};
__export(cli_exports, {
  run: () => run
});
module.exports = __toCommonJS(cli_exports);
var import_node_util = require("node:util");

// src/commands.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var import_resvg_js = require("@resvg/resvg-js");

// ../core-model/src/defaults.ts
var defaultFontPrefs = () => ({
  family: "iconotype",
  prefix: "icon-",
  postfix: "",
  majorVersion: 1,
  minorVersion: 0,
  emSize: 1024,
  baselinePct: 6.25,
  whitespacePct: 50,
  embed: false,
  selector: "class",
  classSelector: ".icon",
  cssVars: true,
  cssVarsFormat: "css",
  showMetrics: true,
  showMetadata: true,
  showVersion: true,
  classPerGlyph: true,
  propertyPerGlyph: false,
  glyphNamesInFont: true,
  palettePrefix: "palette",
  allColorPalettes: false
});
var defaultPreferences = () => ({
  font: defaultFontPrefs(),
  gridSize: 16,
  historySize: 50,
  showCodes: true,
  showGlyphNames: true
});
var emptySet = (id, name) => ({
  id,
  name,
  height: 1024,
  prevSize: 32,
  hidden: false,
  metadata: {},
  colorThemes: [],
  glyphs: []
});
var emptyProject = (id, name = "Untitled project", now = 0) => ({
  schemaVersion: 1,
  id,
  name,
  createdAt: now,
  sets: [emptySet(id + "-set-0", "Untitled Set")],
  preferences: defaultPreferences(),
  codepoints: {}
});

// ../core-model/src/codepoints.ts
var PUA_START = 59648;
var PUA_END = 63743;
var used = (project) => {
  const s = /* @__PURE__ */ new Set();
  for (const v of Object.values(project.codepoints)) {
    if (Array.isArray(v)) v.forEach((c) => s.add(c));
    else s.add(v);
  }
  return s;
};
function allocate(project, requests, opts = {}) {
  const taken = used(project);
  const assignments = {};
  const overflow = [];
  let cursor = PUA_START;
  if (!opts.reclaim) {
    for (const c of taken) if (c >= cursor) cursor = c + 1;
  }
  const nextFree = (run2) => {
    for (let start = cursor; start + run2 - 1 <= PUA_END; start++) {
      let ok = true;
      for (let i = 0; i < run2; i++) if (taken.has(start + i)) {
        ok = false;
        start += i;
        break;
      }
      if (ok) {
        cursor = start + run2;
        return start;
      }
    }
    return null;
  };
  for (const req of requests) {
    if (project.codepoints[req.name] !== void 0) continue;
    const run2 = Math.max(1, req.layers ?? 1);
    const start = nextFree(run2);
    if (start === null) {
      overflow.push(req.name);
      continue;
    }
    for (let i = 0; i < run2; i++) taken.add(start + i);
    assignments[req.name] = run2 === 1 ? start : Array.from({ length: run2 }, (_, i) => start + i);
  }
  return { assignments, overflow };
}
var hex = (cp) => cp.toString(16).padStart(4, "0");
function serializeLock(project) {
  const rows = Object.entries(project.codepoints).sort((a, b) => {
    const av = Array.isArray(a[1]) ? a[1][0] : a[1];
    const bv = Array.isArray(b[1]) ? b[1][0] : b[1];
    return av - bv;
  });
  const lines = [
    "# iconotype codepoint lock \u2014 append-only.",
    "# Changing an existing line is a BREAKING change for every consumer of this font.",
    "",
    ...rows.map(([name, v]) => Array.isArray(v) ? `${name}	U+${hex(v[0])}..U+${hex(v[v.length - 1])}` : `${name}	U+${hex(v)}`)
  ];
  return lines.join("\n") + "\n";
}
function parseLock(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [name, spec] = t.split(/\s+/);
    if (!name || !spec) continue;
    const range = spec.match(/^U\+([0-9a-fA-F]+)\.\.U\+([0-9a-fA-F]+)$/);
    if (range) {
      const from = parseInt(range[1], 16);
      const to = parseInt(range[2], 16);
      out[name] = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    } else {
      const single = spec.match(/^U\+([0-9a-fA-F]+)$/);
      if (single) out[name] = parseInt(single[1], 16);
    }
  }
  return out;
}

// ../core-io/src/icomoon-types.ts
function detectIcoMoon(data) {
  if (!data || typeof data !== "object") return null;
  const d = data;
  if (d.IcoMoonType === "selection") return "selection";
  if (d.IcoMoonType === "iconSet") return "iconSet";
  if (Array.isArray(d.iconSets)) return "project";
  return null;
}

// ../core-io/src/preserve.ts
function capture(source, mapped) {
  const raw = {};
  for (const [k, v] of Object.entries(source)) if (!mapped.has(k)) raw[k] = structuredClone(v);
  return { keyOrder: Object.keys(source), ...Object.keys(raw).length ? { raw } : {} };
}
function rebuild(p, mapped) {
  const raw = p?.raw ?? {};
  const has = (o, k) => k in o && o[k] !== void 0;
  const out = {};
  for (const k of p?.keyOrder ?? []) {
    if (has(mapped, k)) out[k] = mapped[k];
    else if (has(raw, k)) out[k] = raw[k];
  }
  for (const [k, v] of Object.entries(mapped)) if (!(k in out) && v !== void 0) out[k] = v;
  for (const [k, v] of Object.entries(raw)) if (!(k in out) && v !== void 0) out[k] = v;
  return out;
}

// ../core-io/src/icomoon-import.ts
var ICON_KEYS = /* @__PURE__ */ new Set(["id", "paths", "attrs", "isMulticolor", "isMulticolor2", "tags", "grid", "width"]);
var SELECTION_KEYS = /* @__PURE__ */ new Set(["order", "id", "name", "prevSize", "code", "codes", "ligatures"]);
var SET_KEYS = /* @__PURE__ */ new Set(["id", "metadata", "height", "prevSize", "invisible", "colorThemes", "colorThemeIdx", "icons", "selection"]);
var SET_META_KEYS = /* @__PURE__ */ new Set(["name", "url", "designer", "designerURL", "license", "licenseURL", "importSize"]);
var PROJECT_KEYS = /* @__PURE__ */ new Set(["metadata", "iconSets", "preferences"]);
var PROJECT_META_KEYS = /* @__PURE__ */ new Set(["name", "created"]);
function toPreferences(p) {
  const d = defaultPreferences();
  if (!p) return d;
  const fp = p.fontPref ?? {};
  const metrics = fp.metrics ?? {};
  const meta = fp.metadata ?? {};
  return {
    font: {
      family: meta.fontFamily ?? d.font.family,
      prefix: fp.prefix ?? d.font.prefix,
      postfix: fp.postfix ?? d.font.postfix,
      majorVersion: meta.majorVersion ?? d.font.majorVersion,
      minorVersion: meta.minorVersion ?? d.font.minorVersion,
      emSize: metrics.emSize ?? d.font.emSize,
      baselinePct: metrics.baseline ?? d.font.baselinePct,
      whitespacePct: metrics.whitespace ?? d.font.whitespacePct,
      embed: fp.embed ?? d.font.embed,
      selector: fp.selector === "attribute" ? "attribute" : "class",
      classSelector: fp.classSelector ?? d.font.classSelector,
      cssVars: fp.cssVars ?? d.font.cssVars,
      cssVarsFormat: fp.cssVarsFormat || "css",
      showMetrics: fp.showMetrics ?? d.font.showMetrics,
      showMetadata: fp.showMetadata ?? d.font.showMetadata,
      showVersion: fp.showVersion ?? d.font.showVersion,
      classPerGlyph: d.font.classPerGlyph,
      // IcoMoon's `cssVars` means "define a property per glyph"
      propertyPerGlyph: fp.cssVars ? true : d.font.propertyPerGlyph,
      glyphNamesInFont: d.font.glyphNamesInFont,
      palettePrefix: fp.palettePrefix ?? d.font.palettePrefix,
      allColorPalettes: Boolean(fp.showColorPalettes ?? d.font.allColorPalettes)
    },
    gridSize: p.gridSize ?? d.gridSize,
    historySize: p.historySize ?? d.historySize,
    showCodes: p.showCodes ?? d.showCodes,
    showGlyphNames: d.showGlyphNames
  };
}
function toGlyph(icon, iconIndex, sel, selIndex, setKey, warnings) {
  const name = sel?.name ?? icon.tags[0] ?? `icon-${icon.id}`;
  if (!sel) warnings.push(`glyph "${name}": no selection entry for icon id ${icon.id}; codepoint not imported`);
  const width = icon.width;
  return {
    // IcoMoon ids are unique per SET, not per project
    id: `${setKey}:${icon.id}`,
    name,
    aliases: (sel?.ligatures ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    tags: [...icon.tags],
    paths: [...icon.paths],
    attrs: icon.attrs.map((a) => ({ ...a })),
    grid: icon.grid,
    isMulticolor: Boolean(icon.isMulticolor || icon.isMulticolor2),
    // IcoMoon's `width` is a per-glyph advance in the set's coordinate space
    ...width !== void 0 ? { advanceWidth: width } : {},
    source: {},
    foreign: {
      icoMoonId: icon.id,
      isMulticolor2: icon.isMulticolor2,
      order: sel?.order,
      prevSize: sel?.prevSize,
      icon: { ...capture(icon, ICON_KEYS), index: iconIndex },
      ...sel ? { selection: { ...capture(sel, SELECTION_KEYS), index: selIndex } } : {}
    }
  };
}
function toSet(set, index, projectId, codepoints, warnings) {
  const setKey = `${projectId}-set-${index}`;
  const selIndexById = new Map(set.selection.map((s, i) => [s.id, i]));
  const glyphs = set.icons.map((icon, iconIndex) => {
    const selIndex = selIndexById.get(icon.id);
    const sel = selIndex === void 0 ? void 0 : set.selection[selIndex];
    const glyph = toGlyph(icon, iconIndex, sel, selIndex, setKey, warnings);
    if (sel) {
      if (codepoints[glyph.name] !== void 0) {
        warnings.push(`duplicate glyph name "${glyph.name}" across sets \u2014 codepoints are keyed by name, first wins`);
      } else {
        codepoints[glyph.name] = sel.codes?.length ? [...sel.codes] : sel.code;
      }
    }
    return glyph;
  });
  glyphs.sort((a, b) => (a.foreign?.order ?? 0) - (b.foreign?.order ?? 0));
  return {
    ...emptySet(setKey, set.metadata.name),
    height: set.height,
    prevSize: set.prevSize,
    hidden: Boolean(set.invisible),
    metadata: {
      url: set.metadata.url,
      designer: set.metadata.designer,
      designerURL: set.metadata.designerURL,
      license: set.metadata.license,
      licenseURL: set.metadata.licenseURL,
      importSize: set.metadata.importSize
    },
    colorThemes: structuredClone(set.colorThemes ?? []),
    ...set.colorThemeIdx !== void 0 ? { colorThemeIdx: set.colorThemeIdx } : {},
    glyphs,
    foreign: {
      icoMoonId: set.id,
      iconsHash: set.metadata.iconsHash,
      set: capture(set, SET_KEYS),
      metadata: capture(set.metadata, SET_META_KEYS)
    }
  };
}
function selectionFileToProject(file) {
  const sets = /* @__PURE__ */ new Map();
  for (const entry of file.icons) {
    const setId = entry.setId ?? entry.setIdx ?? 0;
    if (!sets.has(setId)) {
      sets.set(setId, {
        id: setId,
        metadata: { name: file.metadata?.name ?? "Imported set" },
        height: file.height ?? 1024,
        prevSize: entry.properties?.prevSize ?? 32,
        icons: [],
        selection: []
      });
    }
    const set = sets.get(setId);
    set.icons.push(entry.icon);
    set.selection.push(entry.properties);
  }
  return { metadata: file.metadata ?? { name: "Imported" }, iconSets: [...sets.values()], preferences: file.preferences };
}
var iconSetFileToProject = (file) => ({
  metadata: { name: file.metadata?.name ?? "Imported set" },
  iconSets: [{ ...file, id: file.id ?? 0 }],
  preferences: {}
});
function importIcoMoon(data, opts = {}) {
  const kind = detectIcoMoon(data);
  if (!kind) throw new Error("not an IcoMoon file: expected `iconSets` (project) or `IcoMoonType` (selection/iconSet)");
  const file = kind === "project" ? data : kind === "selection" ? selectionFileToProject(data) : iconSetFileToProject(data);
  const warnings = [];
  const projectId = opts.projectId ?? "p0";
  const codepoints = {};
  const sets = file.iconSets.map((s, i) => toSet(s, i, projectId, codepoints, warnings));
  return {
    warnings,
    project: {
      schemaVersion: 1,
      id: projectId,
      name: file.metadata?.name ?? "Imported project",
      createdAt: file.metadata?.created ?? 0,
      sets,
      preferences: toPreferences(file.preferences),
      codepoints,
      foreign: {
        kind,
        project: capture(file, PROJECT_KEYS),
        metadata: capture(file.metadata ?? {}, PROJECT_META_KEYS),
        // the whole original preferences block, so unknown keys re-export untouched
        preferences: structuredClone(file.preferences ?? {})
      }
    }
  };
}
var isIcoMoonFile = (data) => detectIcoMoon(data) !== null;

// ../core-io/src/icomoon-export.ts
var pres = (holder, key) => holder?.foreign?.[key];
function toIcon(glyph, index) {
  return rebuild(pres(glyph, "icon"), {
    id: glyph.foreign?.icoMoonId ?? index,
    paths: [...glyph.paths],
    attrs: glyph.attrs.map((a) => ({ ...a })),
    width: glyph.advanceWidth,
    isMulticolor: glyph.isMulticolor && !glyph.foreign?.isMulticolor2,
    isMulticolor2: Boolean(glyph.foreign?.isMulticolor2),
    tags: [...glyph.tags],
    grid: glyph.grid
  });
}
function toSelectionEntry(glyph, index, codepoints) {
  const cp = codepoints[glyph.name];
  const codes = Array.isArray(cp) ? cp : void 0;
  return rebuild(pres(glyph, "selection"), {
    order: glyph.foreign?.order ?? index + 1,
    id: glyph.foreign?.icoMoonId ?? index,
    name: glyph.name,
    prevSize: glyph.foreign?.prevSize ?? glyph.grid ?? 24,
    code: codes ? codes[0] : cp ?? 0,
    ...codes ? { codes: [...codes] } : {},
    ...glyph.aliases.length ? { ligatures: glyph.aliases.join(", ") } : {}
  });
}
function toPreferences2(prefs, original) {
  const out = structuredClone(original);
  out.gridSize = prefs.gridSize;
  out.historySize = prefs.historySize;
  out.showCodes = prefs.showCodes;
  const fp = out.fontPref ??= {};
  fp.prefix = prefs.font.prefix;
  if (prefs.font.postfix) fp.postfix = prefs.font.postfix;
  fp.metadata = { ...fp.metadata ?? {}, fontFamily: prefs.font.family, majorVersion: prefs.font.majorVersion, minorVersion: prefs.font.minorVersion };
  fp.metrics = { ...fp.metrics ?? {}, emSize: prefs.font.emSize, baseline: prefs.font.baselinePct, whitespace: prefs.font.whitespacePct };
  fp.embed = prefs.font.embed;
  fp.cssVars = prefs.font.cssVars;
  if (prefs.font.cssVarsFormat !== "css") fp.cssVarsFormat = prefs.font.cssVarsFormat;
  return out;
}
function exportIcoMoonSelection(project) {
  const icons = [];
  project.sets.forEach((set, setIdx) => {
    set.glyphs.forEach((glyph, iconIdx) => {
      icons.push({
        icon: toIcon(glyph, iconIdx),
        attrs: glyph.attrs.map((a) => ({ ...a })),
        properties: toSelectionEntry(glyph, iconIdx, project.codepoints),
        setIdx,
        setId: set.foreign?.icoMoonId ?? setIdx,
        iconIdx
      });
    });
  });
  return {
    IcoMoonType: "selection",
    icons,
    height: project.sets[0]?.height ?? 1024,
    metadata: { name: project.preferences.font.family },
    preferences: toPreferences2(project.preferences, project.foreign?.preferences ?? {})
  };
}

// ../core-svg/src/paper.ts
var import_paper = __toESM(require("paper"), 1);
var import_paperjs_offset = require("paperjs-offset");
var ready = false;
function getPaper(size = 1024) {
  if (!ready) {
    import_paper.default.setup(new import_paper.default.Size(size, size));
    ready = true;
  }
  return import_paper.default;
}
var fromPathData = (d) => {
  const p = getPaper();
  return d.includes("M") && d.trim().split(/(?=[Mm])/).length > 1 ? new p.CompoundPath(d) : new p.Path(d);
};
function outlineStroke(d, strokeWidth, opts = {}) {
  const path = fromPathData(d);
  try {
    const outlined = import_paperjs_offset.PaperOffset.offsetStroke(path, strokeWidth / 2, {
      join: opts.join ?? "miter",
      cap: opts.cap ?? "butt",
      limit: opts.miterLimit ?? 4,
      insert: false
    });
    const out = outlined.pathData;
    outlined.remove();
    return out;
  } finally {
    path.remove();
  }
}
function clearScene() {
  if (ready) import_paper.default.project.clear();
}

// ../core-svg/src/matrix.ts
var IDENTITY = [1, 0, 0, 1, 0, 0];
function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5]
  ];
}
var rad = (deg) => deg * Math.PI / 180;
function parseTransform(input) {
  if (!input) return [...IDENTITY];
  let m = [...IDENTITY];
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (const match of input.matchAll(re)) {
    const fn = match[1];
    const args = match[2].trim().split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n));
    let t = [...IDENTITY];
    switch (fn) {
      case "matrix":
        if (args.length === 6) t = args;
        break;
      case "translate":
        t = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      case "scale": {
        const sx = args[0] ?? 1;
        t = [sx, 0, 0, args[1] ?? sx, 0, 0];
        break;
      }
      case "rotate": {
        const [a = 0, cx, cy] = args;
        const cos = Math.cos(rad(a)), sin = Math.sin(rad(a));
        const r = [cos, sin, -sin, cos, 0, 0];
        t = cx === void 0 ? r : multiply(multiply([1, 0, 0, 1, cx, cy ?? 0], r), [1, 0, 0, 1, -cx, -(cy ?? 0)]);
        break;
      }
      case "skewX":
        t = [1, 0, Math.tan(rad(args[0] ?? 0)), 1, 0, 0];
        break;
      case "skewY":
        t = [1, Math.tan(rad(args[0] ?? 0)), 0, 1, 0, 0];
        break;
    }
    m = multiply(m, t);
  }
  return m;
}
var scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
function isNonUniform(m, epsilon = 1e-6) {
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  return Math.abs(sx - sy) > epsilon * Math.max(sx, sy, 1);
}
function viewBoxMatrix(viewBox, width, height, size) {
  const vb = (viewBox ?? "").trim().split(/[\s,]+/).map(Number);
  const [minX, minY, vbW, vbH] = vb.length === 4 && vb.every((n) => !Number.isNaN(n)) ? vb : [0, 0, width ?? size, height ?? size];
  if (!vbW || !vbH) return [...IDENTITY];
  const scale = Math.min(size / vbW, size / vbH);
  const dx = (size - vbW * scale) / 2;
  const dy = (size - vbH * scale) / 2;
  return [scale, 0, 0, scale, -minX * scale + dx, -minY * scale + dy];
}

// ../core-svg/src/normalize.ts
var import_svgpath = __toESM(require("svgpath"), 1);
function shapeToPath(tag, a) {
  const n = (k, dflt = 0) => a[k] === void 0 ? dflt : parseFloat(a[k]);
  switch (tag) {
    case "path":
      return a.d ?? null;
    case "rect": {
      const x = n("x"), y = n("y"), w = n("width"), h = n("height");
      let rx = a.rx !== void 0 ? n("rx") : a.ry !== void 0 ? n("ry") : 0;
      let ry = a.ry !== void 0 ? n("ry") : a.rx !== void 0 ? n("rx") : 0;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (!rx && !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case "circle": {
      const cx = n("cx"), cy = n("cy"), r = n("r");
      return `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
    }
    case "ellipse": {
      const cx = n("cx"), cy = n("cy"), rx = n("rx"), ry = n("ry");
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case "line":
      return `M${n("x1")} ${n("y1")}L${n("x2")} ${n("y2")}`;
    case "polyline":
    case "polygon": {
      const pts = (a.points ?? "").trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4) return null;
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i < pts.length - 1; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
      return tag === "polygon" ? d + "Z" : d;
    }
    default:
      return null;
  }
}
function bakePath(d, matrix, opts = {}) {
  let p = (0, import_svgpath.default)(d);
  if (matrix) p = p.matrix(matrix);
  if (opts.sourceHeight && opts.targetHeight && opts.sourceHeight !== opts.targetHeight) {
    p = p.scale(opts.targetHeight / opts.sourceHeight);
  }
  return p.abs().unshort().unarc().round(opts.precision ?? 3).toString();
}

// ../core-svg/src/findings.ts
var SEVERITY = {
  SHAPE_CONVERTED: "info",
  TRANSFORM_BAKED: "info",
  STYLE_INLINED: "info",
  USE_RESOLVED: "info",
  STROKE_OUTLINED: "info",
  EVENODD_CONVERTED: "info",
  CLIP_APPLIED: "info",
  SELF_INTERSECT: "info",
  OPEN_CONTOUR: "info",
  ZERO_AREA_REMOVED: "info",
  SIMPLIFIED: "info",
  SNAPPED: "info",
  REFITTED: "info",
  MASK_APPROXIMATED: "warning",
  CLIP_APPROXIMATED: "warning",
  STROKE_DASHARRAY: "warning",
  STROKE_NONUNIFORM: "warning",
  OPACITY_FLATTENED: "warning",
  MULTIPLE_COLORS: "warning",
  TINY_DETAIL: "warning",
  HIGH_POINT_COUNT: "warning",
  OUT_OF_BOX: "warning",
  NON_INTEGER_GRID: "warning",
  UNSUPPORTED_SELECTOR: "warning",
  NESTED_SVG: "warning",
  SCRIPT_STRIPPED: "warning",
  EXTERNAL_REF: "warning",
  FILTER_DROPPED: "warning",
  GRADIENT_UNSUPPORTED: "error",
  IMAGE_EMBEDDED: "error",
  TEXT_ELEMENT: "error",
  EMPTY: "error"
};
var FindingLog = class {
  #items = /* @__PURE__ */ new Map();
  add(code, message) {
    const existing = this.#items.get(code);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
      return;
    }
    this.#items.set(code, { code, severity: SEVERITY[code], message, count: 1 });
  }
  get list() {
    const order = ["error", "warning", "info"];
    return [...this.#items.values()].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  }
  get hasError() {
    return [...this.#items.values()].some((f) => f.severity === "error");
  }
};

// ../core-svg/src/prepare.ts
var import_svgson = require("svgson");
var import_parser = __toESM(require("css-tree/parser"), 1);
var import_walker = __toESM(require("css-tree/walker"), 1);
var import_generator = __toESM(require("css-tree/generator"), 1);
var DANGEROUS = /* @__PURE__ */ new Set(["script", "foreignObject", "animate", "animateTransform", "animateMotion", "set"]);
var EDITOR_PREFIXES = ["inkscape:", "sodipodi:", "figma:", "sketch:", "illustrator:", "serif:", "krita:"];
var isElement = (n) => n.type === "element";
var children = (n) => (n.children ?? []).filter(isElement);
function indexIds(node, byId) {
  const id = node.attributes?.id;
  if (id && !byId.has(id)) byId.set(id, node);
  for (const child of children(node)) indexIds(child, byId);
}
function sanitize(node, log) {
  const attributes = {};
  for (const [k, v] of Object.entries(node.attributes ?? {})) {
    if (/^on/i.test(k)) {
      log.add("SCRIPT_STRIPPED", `event handler ${k} removed`);
      continue;
    }
    if (EDITOR_PREFIXES.some((p) => k.startsWith(p))) continue;
    if (k === "href" || k === "xlink:href") {
      if (v && !v.startsWith("#") && !v.startsWith("data:")) {
        log.add("EXTERNAL_REF", `external reference ${v} removed`);
        continue;
      }
    }
    if (/javascript:/i.test(v)) {
      log.add("SCRIPT_STRIPPED", `javascript: URL removed`);
      continue;
    }
    attributes[k] = v;
  }
  const kept = [];
  for (const child of node.children ?? []) {
    if (child.type !== "element") {
      kept.push(child);
      continue;
    }
    if (DANGEROUS.has(child.name)) {
      if (child.name === "script") log.add("SCRIPT_STRIPPED", "<script> removed");
      continue;
    }
    kept.push(sanitize(child, log));
  }
  return { ...node, attributes, children: kept };
}
function collectCss(node, rules, log) {
  for (const child of children(node)) {
    if (child.name === "style") {
      const css = (child.children ?? []).map((c) => c.value ?? "").join("");
      try {
        const ast = (0, import_parser.default)(css);
        (0, import_walker.default)(ast, {
          visit: "Rule",
          enter(rule) {
            const decls = {};
            (0, import_walker.default)(rule.block, {
              visit: "Declaration",
              enter(d) {
                decls[d.property] = (0, import_generator.default)(d.value).trim();
              }
            });
            const preludeText = (0, import_generator.default)(rule.prelude);
            for (const raw of preludeText.split(",")) {
              const sel = raw.trim();
              const m = /^([a-zA-Z][\w-]*)?(?:\.([\w-]+))?(?:#([\w-]+))?$/.exec(sel);
              if (!m || !m[1] && !m[2] && !m[3]) {
                log.add("UNSUPPORTED_SELECTOR", `CSS selector "${sel}" ignored \u2014 only tag/.class/#id are resolved`);
                continue;
              }
              rules.push({
                selector: { tag: m[1], cls: m[2], id: m[3] },
                specificity: (m[3] ? 100 : 0) + (m[2] ? 10 : 0) + (m[1] ? 1 : 0),
                decls
              });
            }
          }
        });
        log.add("STYLE_INLINED", "<style> rules resolved into attributes");
      } catch (e) {
        log.add("UNSUPPORTED_SELECTOR", `could not parse <style>: ${e.message}`);
      }
    }
    collectCss(child, rules, log);
  }
}
var parseStyleAttr = (style) => {
  const out = {};
  for (const part of (style ?? "").split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
};
function applyCss(node, rules) {
  const attrs = node.attributes ?? {};
  const classes = (attrs.class ?? "").split(/\s+/).filter(Boolean);
  const matched = rules.filter((r) => (!r.selector.tag || r.selector.tag === node.name) && (!r.selector.cls || classes.includes(r.selector.cls)) && (!r.selector.id || r.selector.id === attrs.id)).sort((a, b) => a.specificity - b.specificity);
  const merged = { ...attrs };
  for (const rule of matched) Object.assign(merged, rule.decls);
  Object.assign(merged, parseStyleAttr(attrs.style));
  delete merged.style;
  return { ...node, attributes: merged, children: (node.children ?? []).map((c) => c.type === "element" ? applyCss(c, rules) : c) };
}
function deref(node, byId, log, depth = 0) {
  const out = [];
  for (const child of node.children ?? []) {
    if (child.type !== "element") {
      out.push(child);
      continue;
    }
    if (child.name === "use") {
      const ref = (child.attributes?.href ?? child.attributes?.["xlink:href"] ?? "").replace(/^#/, "");
      const target = byId.get(ref);
      if (!target || depth > 8) {
        log.add("EXTERNAL_REF", `<use href="#${ref}"> could not be resolved`);
        continue;
      }
      const { x = "0", y = "0", transform, ...restAttrs } = child.attributes ?? {};
      const shift = `translate(${x}, ${y})`;
      const clone = structuredClone(target);
      delete clone.attributes?.id;
      out.push({
        ...child,
        name: "g",
        attributes: { ...restAttrs, transform: [transform, shift].filter(Boolean).join(" ") },
        children: [clone.name === "symbol" ? { ...clone, name: "g" } : clone]
      });
      log.add("USE_RESOLVED", "<use> reference inlined");
      continue;
    }
    out.push(deref(child, byId, log, depth + 1));
  }
  return { ...node, children: out };
}
function prepare(source, log) {
  if (!/<svg[\s/>]/i.test(source)) throw new Error("no <svg> element found \u2014 is this really an SVG file?");
  let root;
  try {
    root = (0, import_svgson.parseSync)(source);
  } catch (e) {
    throw new Error(`could not parse the SVG \u2014 ${e.message}`);
  }
  root = sanitize(root, log);
  const rules = [];
  collectCss(root, rules, log);
  root = applyCss(root, rules);
  const byId = /* @__PURE__ */ new Map();
  indexIds(root, byId);
  root = deref(root, byId, log);
  const finalIds = /* @__PURE__ */ new Map();
  indexIds(root, finalIds);
  return { root, byId: finalIds };
}

// ../core-svg/src/traverse.ts
var SHAPES = /* @__PURE__ */ new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
var CONTAINERS = /* @__PURE__ */ new Set(["g", "a", "svg", "symbol"]);
var DEFS_LIKE = /* @__PURE__ */ new Set([
  "defs",
  "clipPath",
  "mask",
  "marker",
  "pattern",
  "linearGradient",
  "radialGradient",
  "title",
  "desc",
  "metadata",
  "style",
  "filter"
]);
var isNone = (v) => v === void 0 || v === "none" || v === "transparent";
var num = (v, dflt) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : dflt;
};
function isDegenerate(tag, attrs) {
  const n = (k) => parseFloat(attrs[k] ?? "");
  if (tag === "rect") return !(n("width") > 0) || !(n("height") > 0);
  if (tag === "circle") return !(n("r") > 0);
  if (tag === "ellipse") return !(n("rx") > 0) || !(n("ry") > 0);
  return false;
}
var INHERITED = [
  "fill",
  "fill-rule",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-opacity",
  "color"
];
function referencedGeometry(node, matrix, precision, filter) {
  const parts = [];
  const walk2 = (n, m) => {
    for (const child of children(n)) {
      const cm = multiply(m, parseTransform(child.attributes?.transform));
      if (CONTAINERS.has(child.name)) {
        walk2(child, cm);
        continue;
      }
      if (!SHAPES.has(child.name)) continue;
      if (filter && !filter(child)) continue;
      const raw = shapeToPath(child.name, child.attributes ?? {});
      if (raw) parts.push(bakePath(raw, cm, { precision }));
    }
  };
  walk2(node, matrix);
  return parts.join("");
}
function luminanceOf(fill) {
  if (!fill || fill === "none") return 1;
  const key = fill.trim().toLowerCase();
  const named = { white: 1, black: 0 };
  if (key in named) return named[key];
  const hex3 = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(key);
  if (hex3) {
    const h = hex3[1].length === 3 ? [...hex3[1]].map((c) => c + c).join("") : hex3[1];
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const rgb = /rgba?\(([^)]+)\)/.exec(key);
  if (rgb) {
    const [r = 0, g = 0, b = 0] = rgb[1].split(/[\s,]+/).map((n) => parseFloat(n) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return 1;
}
function resolveReference(attr, byId, log) {
  const id = /url\(#([^)]+)\)/.exec(attr ?? "")?.[1];
  if (!id) return null;
  const node = byId.get(id);
  if (!node) {
    log.add("EXTERNAL_REF", `reference #${id} not found`);
    return null;
  }
  const units = node.attributes?.clipPathUnits ?? node.attributes?.maskContentUnits;
  if (units === "objectBoundingBox") {
    log.add("CLIP_APPROXIMATED", "objectBoundingBox units approximated as userSpaceOnUse");
  }
  return node;
}
function traverse(node, ctx, byId, out, log) {
  for (const child of children(node)) {
    const tag = child.name;
    const attrs = child.attributes ?? {};
    if (DEFS_LIKE.has(tag)) continue;
    if (tag === "text" || tag === "tspan") {
      log.add("TEXT_ELEMENT", "text needs the source font to become paths, convert it first");
      continue;
    }
    if (tag === "image") {
      log.add("IMAGE_EMBEDDED", "image cannot be represented in a font");
      continue;
    }
    if (attrs.filter && attrs.filter !== "none") {
      log.add("FILTER_DROPPED", "filter cannot be represented in a font and was dropped");
    }
    const matrix = multiply(ctx.matrix, parseTransform(attrs.transform));
    const style = { ...ctx.style };
    for (const key of INHERITED) if (attrs[key] !== void 0) style[key] = attrs[key];
    const groupOpacity = ctx.opacity * num(attrs.opacity, 1);
    let clip = ctx.clip;
    const clipNode = resolveReference(attrs["clip-path"], byId, log);
    if (clipNode) {
      const geometry = referencedGeometry(clipNode, matrix, ctx.precision);
      clip = clip ? clip + geometry : geometry;
      log.add("CLIP_APPLIED", "clipPath resolved as a boolean intersection");
    }
    let maskKeep = ctx.maskKeep;
    let maskCut = ctx.maskCut;
    const maskNode = resolveReference(attrs.mask, byId, log);
    if (maskNode) {
      const keep = referencedGeometry(maskNode, matrix, ctx.precision, (n) => luminanceOf(n.attributes?.fill) > 0.5);
      const cut = referencedGeometry(maskNode, matrix, ctx.precision, (n) => luminanceOf(n.attributes?.fill) <= 0.5);
      if (keep) maskKeep = (maskKeep ?? "") + keep;
      if (cut) maskCut = (maskCut ?? "") + cut;
      log.add("MASK_APPROXIMATED", "mask approximated: light areas keep, dark areas cut");
    }
    if (CONTAINERS.has(tag)) {
      if (tag === "svg") log.add("NESTED_SVG", "nested svg flattened, its own viewBox is ignored");
      traverse(child, { ...ctx, matrix, style, clip, maskKeep, maskCut, opacity: groupOpacity }, byId, out, log);
      continue;
    }
    if (!SHAPES.has(tag)) continue;
    if (isDegenerate(tag, attrs)) {
      log.add("ZERO_AREA_REMOVED", `${tag} with zero width, height or radius removed`);
      continue;
    }
    const raw = shapeToPath(tag, attrs);
    if (!raw) continue;
    if (tag !== "path") log.add("SHAPE_CONVERTED", `${tag} converted to a path`);
    if (matrix.join() !== "1,0,0,1,0,0") log.add("TRANSFORM_BAKED", "transforms baked into path data");
    for (const paint of [style.fill, style.stroke]) {
      if (paint && /^url\(/.test(paint)) {
        log.add("GRADIENT_UNSUPPORTED", `${paint} cannot be represented in a font`);
      }
    }
    const placed = bakePath(raw, matrix, { precision: ctx.precision });
    const strokeWidth = num(style["stroke-width"], 1);
    const hasStroke = !isNone(style.stroke) && strokeWidth > 0;
    const explicitNoFill = style.fill !== void 0 && isNone(style.fill);
    const fillOpacity = groupOpacity * num(style["fill-opacity"], 1);
    if (!explicitNoFill) {
      out.push({
        d: placed,
        fill: style.fill ?? null,
        evenOdd: style["fill-rule"] === "evenodd",
        clip,
        maskKeep,
        maskCut,
        opacity: fillOpacity
      });
    }
    if (hasStroke) {
      if (isNonUniform(matrix)) {
        log.add("STROKE_NONUNIFORM", "non-uniform scaling on a stroked shape, outline width is approximated");
      }
      if (style["stroke-dasharray"] && style["stroke-dasharray"] !== "none") {
        log.add("STROKE_DASHARRAY", "dashed stroke outlined as solid");
      }
      out.push({
        d: outlineStroke(placed, strokeWidth * scaleOf(matrix), {
          cap: style["stroke-linecap"] === "round" ? "round" : "butt",
          join: style["stroke-linejoin"] ?? "miter",
          miterLimit: num(style["stroke-miterlimit"], 4)
        }),
        fill: isNone(style.stroke) ? null : style.stroke ?? null,
        evenOdd: false,
        clip,
        maskKeep,
        maskCut,
        opacity: groupOpacity * num(style["stroke-opacity"], 1)
      });
      log.add("STROKE_OUTLINED", "stroke converted to an outline");
    }
  }
}

// ../core-svg/src/geometry.ts
var P = () => getPaper();
var parsePath = (d) => new (P()).CompoundPath({ pathData: d, insert: false });
var pathData = (item) => item.pathData ?? "";
var contoursOf = (item) => {
  const cp = item;
  return (cp.children?.length ? cp.children : [item]).filter(Boolean);
};
function evenOddToNonZero(d) {
  const item = parsePath(d);
  item.fillRule = "evenodd";
  const reoriented = item.reorient(false);
  const out = pathData(reoriented);
  reoriented.remove();
  item.remove();
  return out;
}
function applyClipAndMask(d, clip, maskKeep, maskCut) {
  if (!clip && !maskKeep && !maskCut) return d;
  let item = parsePath(d);
  const combine = (other, op) => {
    const mask = parsePath(other);
    const next = op === "intersect" ? item.intersect(mask) : item.subtract(mask);
    mask.remove();
    item.remove();
    item = next;
  };
  if (clip) combine(clip, "intersect");
  if (maskKeep) combine(maskKeep, "intersect");
  if (maskCut) combine(maskCut, "subtract");
  const out = pathData(item);
  item.remove();
  return out;
}
function unite(paths2) {
  if (paths2.length === 0) return "";
  if (paths2.length === 1) return paths2[0];
  let acc = parsePath(paths2[0]);
  for (const next of paths2.slice(1)) {
    const other = parsePath(next);
    const merged = acc.unite(other);
    other.remove();
    acc.remove();
    acc = merged;
  }
  const out = pathData(acc);
  acc.remove();
  return out;
}
function hygiene(d, opts, log) {
  if (!d.trim()) return d;
  const item = parsePath(d);
  const openContours = contoursOf(item).filter((c) => !c.closed).length;
  if (openContours) {
    for (const contour of contoursOf(item)) if (!contour.closed) contour.closePath();
    log.add("OPEN_CONTOUR", `${openContours} open contour(s) closed \u2014 a font glyph has no open paths`);
  }
  const crossings = contoursOf(item).reduce((n, c) => n + (c.getCrossings?.(c)?.length ?? 0), 0);
  const resolved = item.resolveCrossings();
  if (crossings) log.add("SELF_INTERSECT", "self-intersections resolved");
  const minArea = opts.minArea ?? 0;
  if (minArea > 0) {
    let removed = 0;
    for (const contour of contoursOf(resolved)) {
      if (Math.abs(contour.area) < minArea) {
        contour.remove();
        removed++;
      }
    }
    if (removed) log.add("ZERO_AREA_REMOVED", `${removed} degenerate contour(s) removed`);
  }
  if (opts.simplifyTolerance && opts.simplifyTolerance > 0) {
    const before = contoursOf(resolved).reduce((n, c) => n + c.segments.length, 0);
    for (const contour of contoursOf(resolved)) contour.simplify(opts.simplifyTolerance);
    const after = contoursOf(resolved).reduce((n, c) => n + c.segments.length, 0);
    if (after < before) log.add("SIMPLIFIED", `${before} to ${after} segments`);
  }
  if (opts.snapGrid && opts.snapGrid > 0) {
    const g = opts.snapGrid;
    for (const contour of contoursOf(resolved)) {
      for (const segment of contour.segments) {
        segment.point.x = Math.round(segment.point.x / g) * g;
        segment.point.y = Math.round(segment.point.y / g) * g;
      }
    }
    log.add("SNAPPED", `coordinates snapped to a ${g}-unit grid`);
  }
  const out = pathData(resolved);
  resolved.remove();
  item.remove();
  return out;
}
function boundsOf(paths2) {
  const joined = paths2.filter(Boolean).join("");
  if (!joined.trim()) return null;
  const item = parsePath(joined);
  const b = item.bounds;
  const out = { x: b.x, y: b.y, width: b.width, height: b.height };
  item.remove();
  return out.width || out.height ? out : null;
}
function fitPaths(paths2, target, mode, padding, log) {
  if (mode === "none") return { paths: paths2, scale: 1 };
  const bounds = boundsOf(paths2);
  if (!bounds) return { paths: paths2, scale: 1 };
  const inner = target - padding * 2;
  const scale = Math.min(inner / bounds.width, inner / bounds.height);
  const dx = padding + (inner - bounds.width * scale) / 2 - bounds.x * scale;
  const dy = padding + (inner - bounds.height * scale) / 2 - bounds.y * scale;
  if (Math.abs(scale - 1) < 1e-6 && Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    return { paths: paths2, scale: 1 };
  }
  log.add("REFITTED", `artwork scaled by ${scale.toFixed(3)} and centred in the ${target}-unit box`);
  return {
    scale,
    paths: paths2.map((d) => {
      if (!d.trim()) return d;
      const item = parsePath(d);
      item.scale(scale, new (P()).Point(0, 0));
      item.translate(new (P()).Point(dx, dy));
      const out = pathData(item);
      item.remove();
      return out;
    })
  };
}
function statsOf(paths2) {
  const joined = paths2.filter(Boolean).join("");
  if (!joined.trim()) return { contours: 0, segments: 0, bounds: null };
  const item = parsePath(joined);
  const contours = contoursOf(item);
  const stats = {
    contours: contours.length,
    segments: contours.reduce((n, c) => n + c.segments.length, 0),
    bounds: { x: item.bounds.x, y: item.bounds.y, width: item.bounds.width, height: item.bounds.height }
  };
  item.remove();
  return stats;
}

// ../core-svg/src/pipeline.ts
var import_svgpath2 = __toESM(require("svgpath"), 1);
var DEFAULTS = {
  targetHeight: 1024,
  precision: 2,
  simplifyTolerance: 0,
  snapGrid: 0,
  minAreaFraction: 1e-6,
  fit: "none",
  padding: 0,
  tinyDetailPx: 0.75,
  maxSegments: 4e3
};
function validate(paths2, target, opts, log) {
  const stats = statsOf(paths2);
  if (!stats.contours) {
    log.add("EMPTY", "no drawable geometry survived the pipeline");
    return stats;
  }
  if (paths2.some((d) => /(NaN|Infinity)/.test(d))) {
    log.add("EMPTY", "geometry contains NaN or Infinity and cannot be used");
  }
  const b = stats.bounds;
  const slack = target * 1e-3;
  if (b.x < -slack || b.y < -slack || b.x + b.width > target + slack || b.y + b.height > target + slack) {
    log.add("OUT_OF_BOX", `artwork extends outside the ${target}-unit em box (${Math.round(b.x)}, ${Math.round(b.y)} to ${Math.round(b.x + b.width)}, ${Math.round(b.y + b.height)})`);
  }
  if (stats.segments > opts.maxSegments) {
    log.add("HIGH_POINT_COUNT", `${stats.segments} segments \u2014 large glyphs bloat the font and slow rasterization`);
  }
  const smallest = Math.min(b.width, b.height);
  const renderedPx = smallest / target * 16;
  if (smallest > 0 && renderedPx < opts.tinyDetailPx) {
    log.add("TINY_DETAIL", `smallest dimension renders at ${renderedPx.toFixed(2)} px at a 16 px icon size`);
  }
  return stats;
}
function fixSvg(source, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const log = new FindingLog();
  clearScene();
  const { root, byId } = prepare(source, log);
  const attrs = root.attributes ?? {};
  const base = multiply(
    viewBoxMatrix(attrs.viewBox, parseFloat(attrs.width ?? ""), parseFloat(attrs.height ?? ""), opts.targetHeight),
    parseTransform(attrs.transform)
  );
  const emitted = [];
  traverse(root, { matrix: base, style: {}, opacity: 1, precision: opts.precision }, byId, emitted, log);
  const visible = emitted.filter((e) => {
    if (e.opacity < 0.05) {
      log.add("OPACITY_FLATTENED", "near-transparent shape dropped \u2014 a font glyph has no opacity");
      return false;
    }
    if (e.opacity < 1) log.add("OPACITY_FLATTENED", "partial opacity flattened to solid");
    return Boolean(e.d.trim());
  });
  const resolved = visible.map((e) => ({
    fill: e.fill,
    d: applyClipAndMask(e.evenOdd ? evenOddToNonZero(e.d) : e.d, e.clip, e.maskKeep, e.maskCut)
  }));
  if (visible.some((e) => e.evenOdd)) log.add("EVENODD_CONVERTED", "even-odd fill converted to non-zero winding");
  const layers = /* @__PURE__ */ new Map();
  for (const shape of resolved) {
    if (!shape.d.trim()) continue;
    const key = shape.fill ?? "__default__";
    const bucket = layers.get(key);
    if (bucket) bucket.push(shape.d);
    else layers.set(key, [shape.d]);
  }
  const minArea = opts.minAreaFraction * opts.targetHeight * opts.targetHeight;
  const cleaned = [...layers.entries()].map(([fill, group]) => ({
    fill,
    d: hygiene(unite(group), {
      minArea,
      simplifyTolerance: opts.simplifyTolerance,
      snapGrid: opts.snapGrid,
      precision: opts.precision
    }, log)
  }));
  const surviving = cleaned.filter((layer) => layer.d.trim() !== "");
  const fitted = fitPaths(surviving.map((l) => l.d), opts.targetHeight, opts.fit, opts.padding, log);
  const paths2 = fitted.paths.map((d) => (0, import_svgpath2.default)(d).abs().unshort().unarc().round(opts.precision).toString());
  const keys = surviving.map((l) => l.fill);
  const isMulticolor = keys.length > 1;
  if (isMulticolor) log.add("MULTIPLE_COLORS", `${keys.length} distinct fills become ${keys.length} glyph layers`);
  const stats = validate(paths2, opts.targetHeight, opts, log);
  clearScene();
  return {
    paths: paths2,
    attrs: keys.map((fill) => fill === "__default__" ? {} : { fill }),
    isMulticolor,
    findings: log.list,
    stats
  };
}
function fixPaths(paths2, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const log = new FindingLog();
  clearScene();
  const minArea = opts.minAreaFraction * opts.targetHeight * opts.targetHeight;
  let out = paths2.map((d) => hygiene(d, {
    minArea,
    simplifyTolerance: opts.simplifyTolerance,
    snapGrid: opts.snapGrid,
    precision: opts.precision
  }, log));
  const fitted = fitPaths(out, opts.targetHeight, opts.fit, opts.padding, log);
  out = fitted.paths.map((d) => (0, import_svgpath2.default)(d).abs().unshort().unarc().round(opts.precision).toString());
  const stats = validate(out, opts.targetHeight, opts, log);
  clearScene();
  const attrs = (options.attrs ?? paths2.map(() => ({}))).slice(0, out.length);
  return { paths: out, attrs, isMulticolor: attrs.length > 1, findings: log.list, stats };
}

// ../core-io/src/svg-import.ts
var glyphNameFrom = (filename) => filename.replace(/\.svg$/i, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
function importSvg(source, name, opts = {}) {
  let result;
  try {
    result = fixSvg(source, opts);
  } catch (e) {
    throw new Error(`${name}: ${e.message}`);
  }
  return {
    findings: result.findings,
    warnings: result.findings.filter((f) => f.severity !== "info").map((f) => `${f.code}: ${f.message}`),
    glyph: {
      id: `svg:${name}`,
      name: glyphNameFrom(name),
      aliases: [],
      tags: [name.replace(/\.svg$/i, "")],
      paths: result.paths,
      attrs: result.attrs,
      grid: opts.grid ?? 0,
      isMulticolor: result.isMulticolor,
      source: { importedFrom: name }
    }
  };
}

// ../core-io/src/zip.ts
var import_fflate = require("fflate");
var readZip = (data) => Object.entries((0, import_fflate.unzipSync)(data)).map(([path, bytes2]) => ({ path, data: bytes2 }));
var ZIP_EPOCH = new Date(Date.UTC(1980, 0, 1));
function importIcoMoonZip(data, opts = {}) {
  const entries = readZip(data);
  const selection = entries.find((e) => /(^|\/)selection\.json$/i.test(e.path));
  if (!selection) {
    throw new Error(
      `no selection.json in the zip (found: ${entries.map((e) => e.path).slice(0, 8).join(", ")}). Download the font package from IcoMoon rather than the SVG-only archive.`
    );
  }
  return importIcoMoon(JSON.parse((0, import_fflate.strFromU8)(selection.data)), opts);
}

// ../core-io/src/iconfont-file.ts
var ICONFONT_EXTENSION = ".iconotype.json";
var ICONFONT_SCHEMA_VERSION = 1;
var toHex = (code) => code.toString(16);
var fromHex = (code) => parseInt(code.replace(/^(u\+|0x)/i, ""), 16);
function toIconFontFile(project) {
  const prefs = project.preferences.font;
  const height = project.sets[0]?.height ?? 1024;
  const icons = [];
  for (const set of project.sets) {
    if (set.hidden) continue;
    for (const glyph of set.glyphs) {
      const cp = project.codepoints[glyph.name];
      const codes = cp === void 0 ? [] : Array.isArray(cp) ? cp : [cp];
      icons.push({
        name: glyph.name,
        code: toHex(codes[0] ?? 0),
        ...codes.length > 1 ? { codes: codes.slice(1).map(toHex) } : {},
        ...glyph.selected === false ? { selected: false } : {},
        ...glyph.tags.length && glyph.tags.join() !== glyph.name ? { tags: glyph.tags } : {},
        ...glyph.aliases.length ? { ligatures: glyph.aliases } : {},
        ...glyph.grid ? { grid: glyph.grid } : {},
        ...glyph.advanceWidth !== void 0 ? { width: glyph.advanceWidth } : {},
        paths: glyph.paths,
        ...glyph.isMulticolor ? { colors: glyph.attrs.map((a) => a.fill ?? "") } : {},
        ...glyph.source && Object.keys(glyph.source).length ? { source: glyph.source } : {}
      });
    }
  }
  icons.sort((a, b) => fromHex(a.code) - fromHex(b.code) || a.name.localeCompare(b.name));
  const credits = project.sets.filter((s) => s.metadata.license || s.metadata.designer || s.metadata.url).map((s) => ({
    name: s.name,
    ...s.metadata.license ? { license: s.metadata.license } : {},
    ...s.metadata.licenseURL ? { licenseURL: s.metadata.licenseURL } : {},
    ...s.metadata.designer ? { designer: s.metadata.designer } : {},
    ...s.metadata.url ? { url: s.metadata.url } : {}
  }));
  return {
    $schema: "https://iconotype.dev/schema/iconfont-1.json",
    schemaVersion: ICONFONT_SCHEMA_VERSION,
    name: prefs.family,
    font: {
      family: prefs.family,
      prefix: prefs.prefix,
      ...prefs.usagePrefixes?.length ? { usagePrefixes: [...prefs.usagePrefixes] } : {},
      ...prefs.postfix ? { postfix: prefs.postfix } : {},
      emSize: prefs.emSize,
      baseline: prefs.baselinePct,
      whitespace: prefs.whitespacePct,
      version: `${prefs.majorVersion}.${prefs.minorVersion}`,
      // only non-default switches are written, so the file stays quiet
      ...prefs.classPerGlyph === false ? { classPerGlyph: false } : {},
      ...prefs.propertyPerGlyph ? { propertyPerGlyph: true } : {},
      ...prefs.glyphNamesInFont === false ? { glyphNames: false } : {},
      ...prefs.palettePrefix && prefs.palettePrefix !== "palette" ? { palettePrefix: prefs.palettePrefix } : {},
      ...prefs.allColorPalettes ? { allColorPalettes: true } : {},
      ...prefs.metadata && Object.keys(prefs.metadata).length ? { metadata: prefs.metadata } : {}
    },
    height,
    ...project.output ? { output: project.output } : {},
    icons,
    ...credits.length ? { credits } : {}
  };
}
function fromIconFontFile(file, id = "p0") {
  if (file.schemaVersion > ICONFONT_SCHEMA_VERSION) {
    throw new Error(
      `this project needs a newer Iconotype: file schemaVersion ${file.schemaVersion}, this build understands ${ICONFONT_SCHEMA_VERSION}`
    );
  }
  const prefs = defaultPreferences();
  const [major = 1, minor = 0] = (file.font?.version ?? "1.0").split(".").map(Number);
  prefs.font = {
    ...prefs.font,
    family: file.font?.family ?? file.name,
    prefix: file.font?.prefix ?? "icon-",
    ...file.font?.usagePrefixes?.length ? { usagePrefixes: [...file.font.usagePrefixes] } : {},
    postfix: file.font?.postfix ?? "",
    emSize: file.font?.emSize ?? 1024,
    baselinePct: file.font?.baseline ?? 6.25,
    whitespacePct: file.font?.whitespace ?? 50,
    majorVersion: major,
    minorVersion: minor,
    classPerGlyph: file.font?.classPerGlyph ?? true,
    propertyPerGlyph: file.font?.propertyPerGlyph ?? false,
    glyphNamesInFont: file.font?.glyphNames ?? true,
    palettePrefix: file.font?.palettePrefix ?? "palette",
    allColorPalettes: file.font?.allColorPalettes ?? false,
    ...file.font?.metadata ? { metadata: file.font.metadata } : {}
  };
  const codepoints = {};
  const glyphs = (file.icons ?? []).map((icon, index) => {
    const codes = [fromHex(icon.code), ...(icon.codes ?? []).map(fromHex)];
    codepoints[icon.name] = codes.length > 1 ? codes : codes[0];
    const colors = icon.colors ?? [];
    return {
      id: `${id}:${icon.name}`,
      name: icon.name,
      aliases: icon.ligatures ?? [],
      tags: icon.tags ?? [icon.name],
      paths: icon.paths,
      attrs: icon.paths.map((_, i) => colors[i] ? { fill: colors[i] } : {}),
      grid: icon.grid ?? 0,
      isMulticolor: colors.length > 1,
      ...icon.width !== void 0 ? { advanceWidth: icon.width } : {},
      ...icon.selected === false ? { selected: false } : {},
      ...icon.source ? { source: icon.source } : {},
      foreign: { order: index }
    };
  });
  const set = {
    ...emptySet(`${id}-set-0`, file.name),
    height: file.height ?? 1024,
    glyphs
  };
  const credit = file.credits?.[0];
  if (credit) {
    set.metadata = {
      license: credit.license,
      licenseURL: credit.licenseURL,
      designer: credit.designer,
      url: credit.url
    };
  }
  return {
    schemaVersion: 1,
    id,
    name: file.name,
    createdAt: 0,
    sets: [set],
    preferences: prefs,
    codepoints,
    ...file.output ? { output: file.output } : {}
  };
}
var serializeIconFont = (project) => JSON.stringify(toIconFontFile(project), null, 2) + "\n";
var isIconFontFile = (data) => typeof data === "object" && data !== null && typeof data.schemaVersion === "number" && Array.isArray(data.icons);

// ../core-font/src/metrics.ts
function metricsFrom(prefs) {
  const unitsPerEm = prefs.emSize;
  const descender = -Math.round(unitsPerEm * prefs.baselinePct / 100);
  return { unitsPerEm, ascender: unitsPerEm + descender, descender };
}
function svgToFontMatrix(sourceHeight, m) {
  const s = m.unitsPerEm / sourceHeight;
  return [s, 0, 0, -s, 0, m.ascender];
}
var advanceFor = (advanceWidth, sourceHeight, m) => advanceWidth === void 0 ? m.unitsPerEm : Math.round(advanceWidth * m.unitsPerEm / sourceHeight);

// ../core-font/src/svgfont.ts
var import_svgpath3 = __toESM(require("svgpath"), 1);
var xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
var unicodeAttr = (s) => [...s].map((c) => `&#x${c.codePointAt(0).toString(16)};`).join("");
function codesFor(project, glyph) {
  const cp = project.codepoints[glyph.name];
  if (cp === void 0) return null;
  return Array.isArray(cp) ? cp : [cp];
}
function buildSvgFont(project) {
  const metrics = metricsFrom(project.preferences.font);
  const warnings = [];
  const glyphs = [];
  const seenCodes = /* @__PURE__ */ new Map();
  const emit = (set, glyph) => {
    const codes = codesFor(project, glyph);
    if (!codes) {
      warnings.push({ code: "NO_CODEPOINT", message: `"${glyph.name}" has no codepoint and was skipped` });
      return;
    }
    const matrix = svgToFontMatrix(set.height, metrics);
    const advanceWidth = advanceFor(glyph.advanceWidth, set.height, metrics);
    const layers = glyph.isMulticolor ? glyph.paths.map((d) => [d]) : [glyph.paths];
    const layerCount = layers.length;
    if (codes.length < layerCount) {
      warnings.push({
        code: "MISSING_LAYER_CODES",
        message: `"${glyph.name}" has ${layerCount} colour layers but only ${codes.length} codepoint(s); extra layers dropped`
      });
    }
    layers.slice(0, codes.length).forEach((subpaths, i) => {
      const code = codes[i];
      const clash = seenCodes.get(code);
      if (clash) {
        warnings.push({ code: "DUPLICATE_CODEPOINT", message: `U+${code.toString(16)} used by both "${clash}" and "${glyph.name}"` });
      }
      seenCodes.set(code, glyph.name);
      glyphs.push({
        name: layerCount > 1 ? `${glyph.name}-path${i + 1}` : glyph.name,
        code,
        layer: layerCount > 1 ? i + 1 : 0,
        layerCount,
        ligatures: i === 0 ? glyph.aliases : [],
        color: glyph.attrs[i]?.fill,
        advanceWidth,
        pathData: subpaths.map((d) => (0, import_svgpath3.default)(d).matrix(matrix).abs().unshort().unarc().round(1).toString()).join("")
      });
    });
  };
  for (const set of project.sets) {
    if (set.hidden) continue;
    for (const glyph of set.glyphs) if (glyph.selected !== false) emit(set, glyph);
  }
  glyphs.sort((a, b) => a.code - b.code);
  const ligatureChars = [...new Set(glyphs.flatMap((g) => g.ligatures).flatMap((l) => [...l]))].sort();
  if (ligatureChars.length) {
    warnings.push({
      code: "LIGATURE_BLANKS",
      message: `${ligatureChars.length} blank character glyph(s) added so ligatures can trigger (${ligatureChars.join("")})`
    });
  }
  const space = Math.round(metrics.unitsPerEm * project.preferences.font.whitespacePct / 100);
  const family = project.preferences.font.family;
  const lines = [
    '<?xml version="1.0" standalone="no"?>',
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',
    '<svg xmlns="http://www.w3.org/2000/svg">',
    "<defs>",
    `<font id="${xml(family)}" horiz-adv-x="${metrics.unitsPerEm}">`,
    `<font-face font-family="${xml(family)}" font-weight="400" font-stretch="normal" units-per-em="${metrics.unitsPerEm}" ascent="${metrics.ascender}" descent="${metrics.descender}" />`,
    `<missing-glyph horiz-adv-x="${metrics.unitsPerEm}" />`,
    `<glyph unicode="&#x20;" glyph-name="space" horiz-adv-x="${space}" d="" />`
    // eslint-disable-line
  ];
  for (const c of ligatureChars) {
    lines.push(`<glyph unicode="${unicodeAttr(c)}" glyph-name="ligature-${c.codePointAt(0).toString(16)}" horiz-adv-x="0" d="" />`);
  }
  const named = project.preferences.font.glyphNamesInFont !== false;
  const nameAttr = (name) => named ? ` glyph-name="${xml(name)}"` : "";
  for (const g of glyphs) {
    lines.push(
      `<glyph unicode="${unicodeAttr(String.fromCodePoint(g.code))}"${nameAttr(g.name)} horiz-adv-x="${g.advanceWidth}" d="${xml(g.pathData)}" />`
    );
    for (const liga of g.ligatures) {
      lines.push(
        `<glyph unicode="${unicodeAttr(liga)}"${nameAttr(`${g.name}-liga-${liga}`)} horiz-adv-x="${g.advanceWidth}" d="${xml(g.pathData)}" />`
      );
    }
  }
  lines.push("</font>", "</defs>", "</svg>");
  return { svg: lines.join("\n"), glyphs, metrics, warnings, ligatureChars };
}

// ../core-font/src/build.ts
var import_svg2ttf = __toESM(require("svg2ttf"), 1);
var import_ttf2woff = __toESM(require("ttf2woff"), 1);
var import_woff2_encoder = require("woff2-encoder");
var bytes = (v) => v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer);
async function buildFont(project, opts = {}) {
  const formats = new Set(opts.formats ?? ["svg", "ttf", "woff", "woff2"]);
  const source = buildSvgFont(project);
  const build2 = {
    svg: source.svg,
    glyphs: source.glyphs,
    metrics: source.metrics,
    warnings: [...source.warnings],
    ligatureChars: source.ligatureChars
  };
  const needsTtf = formats.has("ttf") || formats.has("woff") || formats.has("woff2");
  if (!needsTtf) return build2;
  const meta = project.preferences.font.metadata ?? {};
  const ttf = bytes((0, import_svg2ttf.default)(source.svg, {
    ts: opts.timestamp ?? 0,
    version: `Version ${project.preferences.font.majorVersion}.${project.preferences.font.minorVersion}`,
    description: meta.description ?? "Generated by Iconotype",
    ...meta.copyright ? { copyright: meta.copyright } : {},
    ...meta.url ?? meta.designerURL ? { url: meta.url ?? meta.designerURL } : {}
  }).buffer);
  if (formats.has("ttf")) build2.ttf = ttf;
  if (formats.has("woff")) build2.woff = bytes((0, import_ttf2woff.default)(ttf, { metadata: void 0 }));
  if (formats.has("woff2")) {
    try {
      build2.woff2 = bytes(await (0, import_woff2_encoder.compress)(ttf));
    } catch (e) {
      build2.warnings.push({ code: "WOFF2_FAILED", message: `WOFF2 encoding failed: ${e.message}` });
    }
  }
  return build2;
}

// ../core-font/src/css.ts
var MIME = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  svg: "image/svg+xml"
};
var FORMAT_HINT = {
  woff2: "woff2",
  woff: "woff",
  ttf: "truetype",
  svg: "svg"
};
var ORDER = ["woff2", "woff", "ttf", "svg"];
var base64 = (data) => {
  let s = "";
  for (let i = 0; i < data.length; i += 32768) s += String.fromCharCode(...data.subarray(i, i + 32768));
  return typeof btoa === "function" ? btoa(s) : Buffer.from(data).toString("base64");
};
var hex2 = (code) => code.toString(16);
var interpolate = (template, index, code) => template.replace(/\$\{i\}/g, String(index)).replace(/\$\{u\}/g, hex2(code));
var classNameOf = (prefs, name, index, code) => `${interpolate(prefs.prefix, index, code)}${name}${interpolate(prefs.postfix, index, code)}`;
function groupIcons(glyphs) {
  const byIcon = /* @__PURE__ */ new Map();
  for (const g of glyphs) {
    const key = g.name.replace(/-path\d+$/, "");
    const bucket = byIcon.get(key);
    if (bucket) bucket.push(g);
    else byIcon.set(key, [g]);
  }
  return [...byIcon.entries()].map(([name, layers]) => ({ name, layers }));
}
function buildPaletteRules(project) {
  const prefs = project.preferences.font;
  const palettes = project.sets.flatMap((set) => set.colorThemes);
  if (!palettes.length) return [];
  const out = ["/* colour palettes */"];
  palettes.forEach((palette, index) => {
    const selector = `.${prefs.palettePrefix}${index + 1}`;
    palette.forEach((rgba, layer) => {
      const [r, g, b, a = 1] = rgba;
      const color = a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
      out.push(`${selector} .path${layer + 1}:before { color: ${color}; }`);
    });
  });
  out.push("");
  return out;
}
function buildCss(project, build2, opts = {}) {
  const prefs = project.preferences.font;
  const family = prefs.family;
  const dir = opts.fontPath ?? "fonts/";
  const query = opts.version ? `?${opts.version}` : "";
  const available = ORDER.filter((f) => f === "svg" ? true : build2[f] !== void 0).filter((f) => !opts.formats || opts.formats.includes(f));
  const srcs = [];
  if (opts.embed) {
    const first = available.find((f) => f !== "svg" && build2[f]);
    if (first) {
      const data = build2[first];
      srcs.push(`url(data:${MIME[first]};charset=utf-8;base64,${base64(data)}) format('${FORMAT_HINT[first]}')`);
    }
  } else {
    for (const f of available) {
      const url = f === "svg" ? `${dir}${family}.svg${query}#${family}` : `${dir}${family}.${f}${query}`;
      srcs.push(`url('${url}') format('${FORMAT_HINT[f]}')`);
    }
  }
  const out = [];
  if (prefs.showMetadata) {
    out.push(`/* ${family} v${prefs.majorVersion}.${prefs.minorVersion} \u2014 generated by Iconotype. Do not edit by hand. */`);
  }
  out.push(
    `@font-face {`,
    `  font-family: '${family}';`,
    `  src: ${srcs.join(",\n       ")};`,
    `  font-weight: normal;`,
    `  font-style: normal;`,
    `  font-display: block;`,
    `}`,
    ``
  );
  const selector = prefs.selector === "attribute" ? `[class^="${prefs.prefix}"], [class*=" ${prefs.prefix}"]` : prefs.classSelector;
  out.push(
    `${selector} {`,
    `  font-family: '${family}' !important;`,
    `  speak: never;`,
    `  font-style: normal;`,
    `  font-weight: normal;`,
    `  font-variant: normal;`,
    `  text-transform: none;`,
    `  line-height: 1;`,
    `  -webkit-font-smoothing: antialiased;`,
    `  -moz-osx-font-smoothing: grayscale;`,
    `}`,
    ``
  );
  const icons = groupIcons(build2.glyphs);
  if (prefs.propertyPerGlyph || prefs.cssVars && prefs.cssVarsFormat === "css") {
    out.push(`:root {`);
    icons.forEach(({ name, layers }, i) => out.push(`  --${interpolate(prefs.prefix, i, layers[0].code)}${name}: "\\${hex2(layers[0].code)}";`));
    out.push(`}`, ``);
  }
  if (prefs.classPerGlyph) {
    icons.forEach(({ name, layers }, i) => {
      const className = classNameOf(prefs, name, i, layers[0].code);
      if (layers.length === 1) {
        out.push(`.${className}:before { content: "\\${hex2(layers[0].code)}"; }`);
        return;
      }
      for (const layer of layers) {
        const color = layer.color ? `
  color: ${layer.color};` : "";
        out.push(
          `.${className} .path${layer.layer}:before {`,
          `  content: "\\${hex2(layer.code)}";${color}`,
          layer.layer > 1 ? `  margin-left: -1em;` : "",
          `}`
        );
      }
    });
  }
  if (prefs.allColorPalettes) out.push("", ...buildPaletteRules(project));
  out.push("");
  return out.filter((l) => l !== void 0).join("\n");
}
function buildVariables(project, build2, format, opts = {}) {
  const sigil = format === "scss" ? "$" : "@";
  const suffix = format === "scss" ? " !default" : "";
  const prefix = project.preferences.font.prefix;
  const family = project.preferences.font.family;
  const fontPath = (opts.fontPath ?? "fonts/").replace(/\/+$/, "");
  return [
    `// ${family} v${project.preferences.font.majorVersion}.${project.preferences.font.minorVersion} \u2014 generated by Iconotype. Do not edit by hand.`,
    `${sigil}${family}-font-family: "${family}"${suffix};`,
    `${sigil}${family}-font-path: "${fontPath}"${suffix};`,
    "",
    ...groupIcons(build2.glyphs).map(({ name, layers }, i) => `${sigil}${interpolate(prefix, i, layers[0].code)}${name}: "\\${hex2(layers[0].code)}";`),
    ""
  ].join("\n");
}
function buildDemoHtml(project, build2) {
  const prefs = project.preferences.font;
  const icons = groupIcons(build2.glyphs);
  const cells = icons.map(({ name, layers }) => {
    const className = classNameOf(prefs, name, icons.findIndex((entry) => entry.name === name), layers[0].code);
    const markup = layers.length === 1 ? `<span class="${className}"></span>` : `<span class="${className}">${layers.map((l) => `<span class="path${l.layer}"></span>`).join("")}</span>`;
    return `      <li>
        <div class="glyph">${markup}</div>
        <div class="name">${name}</div>
        <div class="code">${layers.map((l) => "U+" + hex2(l.code)).join(" ")}</div>
      </li>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${prefs.family} \u2014 ${icons.length} icons</title>
<link rel="stylesheet" href="style.css">
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.meta { color: #888; margin: 0 0 24px; }
  ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px;
       grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
  li { border: 1px solid #8884; border-radius: 6px; padding: 14px 8px; text-align: center; }
  .glyph { font-size: 32px; line-height: 1; margin-bottom: 10px; }
  .name { font-size: 11px; word-break: break-all; }
  .code { font-size: 10px; color: #888; font-family: ui-monospace, monospace; }
  input { font: inherit; padding: 5px 9px; margin-bottom: 18px; width: 240px; }
</style>
</head>
<body>
<h1>${prefs.family}</h1>
<p class="meta">${icons.length} icons \xB7 ${build2.glyphs.length} glyphs \xB7 em ${build2.metrics.unitsPerEm} \xB7 generated by Iconotype</p>
<input id="q" type="search" placeholder="Filter\u2026" oninput="for (const li of document.querySelectorAll('li')) li.hidden = !li.querySelector('.name').textContent.includes(this.value)">
<ul>
${cells}
    </ul>
</body>
</html>
`;
}

// ../core-font/src/bundle.ts
function buildAttribution(project) {
  const lines = [`# Attribution \u2014 ${project.preferences.font.family}`, ""];
  for (const set of project.sets) {
    if (!set.glyphs.length) continue;
    lines.push(`## ${set.name} (${set.glyphs.length} icon${set.glyphs.length === 1 ? "" : "s"})`);
    const m = set.metadata;
    if (m.license) lines.push(`- License: ${m.license}${m.licenseURL ? ` \u2014 ${m.licenseURL}` : ""}`);
    if (m.designer) lines.push(`- Designer: ${m.designer}${m.designerURL ? ` \u2014 ${m.designerURL}` : ""}`);
    if (m.url) lines.push(`- Source: ${m.url}`);
    if (!m.license && !m.designer && !m.url) lines.push("- No licence metadata recorded for this set.");
    lines.push("");
  }
  return lines.join("\n");
}
async function buildBundle(project, opts = {}) {
  const build2 = await buildFont(project, opts);
  const family = project.preferences.font.family;
  const files = [];
  const dir = opts.embed ? "" : opts.fontPath ?? "fonts/";
  if (!opts.embed) {
    if (build2.woff2) files.push({ path: `${dir}${family}.woff2`, data: build2.woff2 });
    if (build2.woff) files.push({ path: `${dir}${family}.woff`, data: build2.woff });
    if (build2.ttf) files.push({ path: `${dir}${family}.ttf`, data: build2.ttf });
    if (!opts.formats || opts.formats.includes("svg")) files.push({ path: `${dir}${family}.svg`, data: build2.svg });
  }
  files.push({ path: "style.css", data: buildCss(project, build2, opts) });
  if (opts.includeVariables !== false && project.preferences.font.cssVars) {
    const format = project.preferences.font.cssVarsFormat;
    if (format === "scss" || format === "less") {
      files.push({ path: `variables.${format}`, data: buildVariables(project, build2, format) });
    }
  }
  if (opts.includeDemo !== false) files.push({ path: "demo.html", data: buildDemoHtml(project, build2) });
  if (opts.includeLock !== false) files.push({ path: "codepoints.lock", data: serializeLock(project) });
  if (opts.includeAttribution !== false) files.push({ path: "ATTRIBUTION.md", data: buildAttribution(project) });
  if (opts.selectionJson) files.push({ path: "selection.json", data: opts.selectionJson });
  return { files, build: build2 };
}

// ../core-export/src/options.ts
var DEFAULT_FORMAT = {
  addTitle: false,
  prependNamesToIds: true,
  fixedSize: false,
  size: 24,
  removeNewlines: false,
  useTabs: false,
  indentSize: 2,
  prefix: "icon-",
  postfix: ""
};
var resolveFormat = (opts = {}) => ({ ...DEFAULT_FORMAT, ...opts });
var indent = (level, opts) => opts.useTabs ? "	".repeat(level) : " ".repeat(level * opts.indentSize);
function finish(text, opts) {
  return opts.removeNewlines ? text.replace(/\n\s*/g, "") : text;
}
var xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
var pascalCase = (name) => name.replace(/(^|[^a-zA-Z0-9])([a-zA-Z0-9])/g, (_, __, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, "");
var identifier = (name) => {
  const camel = name.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => c ? c.toUpperCase() : "");
  return /^[0-9]/.test(camel) ? `icon${camel[0].toUpperCase()}${camel.slice(1)}` : camel;
};

// ../core-export/src/svg.ts
var iconsOf = (project, ids) => project.sets.filter((set) => !set.hidden).flatMap((set) => set.glyphs.map((glyph) => ({ glyph, set }))).filter(({ glyph }) => !ids || ids.has(glyph.id));
var sizeAttrs = (opts) => opts.fixedSize ? ` width="${opts.size}" height="${opts.size}"` : "";
var pathsOf = (glyph, colored) => glyph.paths.map((d, i) => {
  const fill = colored && glyph.attrs[i]?.fill ? ` fill="${xmlEscape(glyph.attrs[i].fill)}"` : "";
  return `<path${fill} d="${d}"/>`;
}).join("");
function exportSvg(entry, options = {}) {
  const opts = resolveFormat(options);
  const { glyph, set } = entry;
  const title = opts.addTitle ? `
${indent(1, opts)}<title>${xmlEscape(glyph.name)}</title>` : "";
  const body = glyph.paths.map((d, i) => {
    const fill = glyph.attrs[i]?.fill ? ` fill="${xmlEscape(glyph.attrs[i].fill)}"` : "";
    return `
${indent(1, opts)}<path${fill} d="${d}"/>`;
  }).join("");
  return finish(
    `<svg xmlns="http://www.w3.org/2000/svg"${sizeAttrs(opts)} viewBox="0 0 ${set.height} ${set.height}">${title}${body}
</svg>
`,
    opts
  );
}
function exportSpriteSymbols(project, entries, options = {}) {
  const opts = resolveFormat(options);
  const symbols = entries.map(({ glyph, set }) => {
    const id = `${opts.prependNamesToIds ? opts.prefix : ""}${glyph.name}${opts.postfix}`;
    const title = opts.addTitle ? `<title>${xmlEscape(glyph.name)}</title>` : "";
    return `${indent(1, opts)}<symbol id="${xmlEscape(id)}" viewBox="0 0 ${set.height} ${set.height}">${title}${pathsOf(glyph, true)}</symbol>`;
  });
  return finish(
    `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
${symbols.join("\n")}
</svg>
`,
    opts
  );
}

// ../core-export/src/components.ts
var paths = (entry) => entry.glyph.paths.map((d, i) => {
  const fill = entry.glyph.attrs[i]?.fill;
  return fill ? `<path fill="${xmlEscape(fill)}" d="${d}"/>` : `<path d="${d}"/>`;
}).join("");
var iconMap = (entries) => entries.map((e) => `  '${e.glyph.name}': ['${e.set.height}', '${paths(e)}'],`).join("\n");
function exportReact(project, entries, options = {}) {
  const opts = resolveFormat(options);
  const name = pascalCase(project.preferences.font.family) || "Icon";
  return `// Generated by Iconotype. Do not edit.
import { type SVGProps } from 'react'

const ICONS = {
${iconMap(entries)}
} as const

export type ${name}Name = keyof typeof ICONS

export interface ${name}Props extends SVGProps<SVGSVGElement> {
  name: ${name}Name
  size?: number | string
  title?: string
}

export function ${name}({ name, size = ${opts.size}, title, ...rest }: ${name}Props) {
  const [box, body] = ICONS[name]
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={\`0 0 \${box} \${box}\`}
      fill="currentColor"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      {...rest}
      dangerouslySetInnerHTML={{ __html: (title ? \`<title>\${title}</title>\` : '') + body }}
    />
  )
}

export const ${name.toLowerCase()}Names = Object.keys(ICONS) as ${name}Name[]
`;
}
function exportVue(project, entries, options = {}) {
  const opts = resolveFormat(options);
  const name = pascalCase(project.preferences.font.family) || "Icon";
  return `<!-- Generated by Iconotype. Do not edit. -->
<script setup lang="ts">
import { computed } from 'vue'

const ICONS: Record<string, [string, string]> = {
${iconMap(entries)}
}

const props = withDefaults(defineProps<{ name: keyof typeof ICONS; size?: number | string; title?: string }>(), {
  size: ${opts.size},
})

const icon = computed(() => ICONS[props.name as string] ?? ['24', ''])
const body = computed(() => (props.title ? \`<title>\${props.title}</title>\` : '') + icon.value[1])
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    :viewBox="\`0 0 \${icon[0]} \${icon[0]}\`"
    fill="currentColor"
    :role="title ? 'img' : 'presentation'"
    :aria-hidden="title ? undefined : true"
    v-html="body"
  />
</template>
`;
}
function exportSvelte(project, entries, options = {}) {
  const opts = resolveFormat(options);
  return `<!-- Generated by Iconotype. Do not edit. -->
<script lang="ts">
  const ICONS: Record<string, [string, string]> = {
${iconMap(entries)}
  }

  let { name, size = ${opts.size}, title, ...rest }: {
    name: keyof typeof ICONS
    size?: number | string
    title?: string
  } & Record<string, unknown> = $props()

  const icon = $derived(ICONS[name as string] ?? ['24', ''])
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 {icon[0]} {icon[0]}"
  fill="currentColor"
  role={title ? 'img' : 'presentation'}
  aria-hidden={title ? undefined : true}
  {...rest}
>
  {#if title}<title>{title}</title>{/if}
  {@html icon[1]}
</svg>
`;
}
function exportWebComponent(project, entries, options = {}) {
  const opts = resolveFormat(options);
  const tag = `${opts.prefix.replace(/-$/, "")}-icon`;
  return `// Generated by Iconotype. Do not edit.
const ICONS = {
${iconMap(entries)}
}

/** <${tag} name="home" size="24"></${tag}> */
export class IconotypeIcon extends HTMLElement {
  static observedAttributes = ['name', 'size', 'title']

  connectedCallback() { this.#render() }
  attributeChangedCallback() { this.#render() }

  #render() {
    const entry = ICONS[this.getAttribute('name')]
    if (!entry) { this.replaceChildren(); return }
    const [box, body] = entry
    const size = this.getAttribute('size') ?? '${opts.size}'
    const title = this.getAttribute('title')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', \`0 0 \${box} \${box}\`)
    svg.setAttribute('width', size)
    svg.setAttribute('height', size)
    svg.setAttribute('fill', 'currentColor')
    svg.setAttribute('aria-hidden', title ? 'false' : 'true')
    // innerHTML on an SVG element is namespace-safe in every browser that supports custom elements
    svg.innerHTML = (title ? \`<title>\${title}</title>\` : '') + body
    this.replaceChildren(svg)
  }
}

if (!customElements.get('${tag}')) customElements.define('${tag}', IconotypeIcon)
`;
}
function exportElm(project, entries) {
  const moduleName = pascalCase(project.preferences.font.family) || "Icons";
  const fn = (e) => {
    const name = identifier(e.glyph.name);
    const nodes = e.glyph.paths.map((d, i) => {
      const fill = e.glyph.attrs[i]?.fill;
      const attrs = [`A.d "${d}"`, ...fill ? [`A.fill "${fill}"`] : []].join(", ");
      return `${i === 0 ? "        [ " : "        , "}Svg.path [ ${attrs} ] []`;
    }).join("\n");
    return `${name} : Int -> Svg msg
${name} size =
    icon size "${e.set.height}"
${nodes}
        ]`;
  };
  const exposed = entries.map((e) => identifier(e.glyph.name)).join(", ");
  return `-- Generated by Iconotype. Do not edit.


module ${moduleName} exposing (${exposed || ".."})

import Svg exposing (Svg)
import Svg.Attributes as A


icon : Int -> String -> List (Svg msg) -> Svg msg
icon size box children =
    Svg.svg
        [ A.viewBox ("0 0 " ++ box ++ " " ++ box)
        , A.width (String.fromInt size)
        , A.height (String.fromInt size)
        , A.fill "currentColor"
        ]
        children


${entries.map(fn).join("\n\n\n")}
`;
}
function exportTypes(project, entries) {
  const family = pascalCase(project.preferences.font.family) || "Icon";
  const names = entries.map((e) => `  | '${e.glyph.name}'`).join("\n");
  const consts = entries.map((e) => {
    const cp = project.codepoints[e.glyph.name];
    const first = Array.isArray(cp) ? cp[0] : cp;
    return `  ${identifier(e.glyph.name)}: '${e.glyph.name}',${first === void 0 ? "" : ` // \\u${first.toString(16)}`}`;
  }).join("\n");
  return `// Generated by Iconotype. Do not edit.

export type ${family}Name =
${names || "  | never"}

export const ${family}Names = {
${consts}
} as const satisfies Record<string, ${family}Name>

export const all${family}Names: ${family}Name[] = Object.values(${family}Names)
`;
}
function exportComponent(target, project, entries, options = {}) {
  switch (target) {
    case "react":
      return exportReact(project, entries, options);
    case "vue":
      return exportVue(project, entries, options);
    case "svelte":
      return exportSvelte(project, entries, options);
    case "webcomponent":
      return exportWebComponent(project, entries, options);
    case "elm":
      return exportElm(project, entries);
  }
}
var componentFilename = (target, project) => {
  const name = pascalCase(project.preferences.font.family) || "Icon";
  switch (target) {
    case "react":
      return `${name}.tsx`;
    case "vue":
      return `${name}.vue`;
    case "svelte":
      return `${name}.svelte`;
    case "webcomponent":
      return `${name.toLowerCase()}-element.js`;
    case "elm":
      return `${name}.elm`;
  }
};

// ../core-export/src/raster.ts
function buildSpriteSheet(project, entries, options = {}) {
  const opts = resolveFormat(options);
  const cell = options.cell ?? 32;
  const margin = options.margin ?? 16;
  const columns = Math.max(1, options.columns ?? 16);
  const rows = Math.ceil(entries.length / columns);
  const step = cell + margin;
  const width = columns * step - margin;
  const height = rows * step - margin;
  const positions = [];
  const nodes = entries.map((entry, i) => {
    const x = i % columns * step;
    const y = Math.floor(i / columns) * step;
    positions.push({ name: entry.glyph.name, x, y });
    const scale = cell / entry.set.height;
    const inner = entry.glyph.paths.map((d, j) => {
      const fill = entry.glyph.attrs[j]?.fill;
      return `<path d="${d}"${fill ? ` fill="${xmlEscape(fill)}"` : ""}/>`;
    }).join("");
    return `  <g transform="translate(${x} ${y}) scale(${scale})">${inner}</g>`;
  });
  const background = options.background ? `  <rect width="${width}" height="${height}" fill="${xmlEscape(options.background)}"/>
` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="${xmlEscape(options.color ?? "#000")}">
` + background + nodes.join("\n") + "\n</svg>\n";
  const css = [
    `.${opts.prefix.replace(/-$/, "")}-sprite {`,
    `  background-image: url('sprite.png');`,
    `  background-repeat: no-repeat;`,
    `  width: ${cell}px;`,
    `  height: ${cell}px;`,
    `}`,
    ...positions.map((p) => `.${opts.prefix}${p.name}${opts.postfix}-sprite { background-position: -${p.x}px -${p.y}px; }`),
    ""
  ].join("\n");
  return { svg, width, height, css, positions };
}
var DEFAULT_FAVICON_SIZES = [
  { size: 16, filename: "favicon-16.png" },
  { size: 32, filename: "favicon-32.png" },
  { size: 180, filename: "apple-touch-icon.png" },
  { size: 192, filename: "icon-192.png" },
  { size: 512, filename: "icon-512.png" }
];
async function buildFavicons(entry, rasterize2, options = {}) {
  const sizes = options.sizes ?? DEFAULT_FAVICON_SIZES;
  const out = [];
  for (const { size, filename } of sizes) {
    const background = options.background ? `<rect width="${entry.set.height}" height="${entry.set.height}" fill="${xmlEscape(options.background)}"/>` : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${entry.set.height} ${entry.set.height}" fill="${xmlEscape(options.color ?? "#000")}">` + background + entry.glyph.paths.map((d) => `<path d="${d}"/>`).join("") + `</svg>`;
    out.push({ path: filename, data: await rasterize2(svg, size, size) });
  }
  out.push({
    path: "site.webmanifest",
    data: JSON.stringify({
      name: options.name ?? entry.glyph.name,
      icons: sizes.filter((s) => s.size >= 192).map((s) => ({ src: s.filename, sizes: `${s.size}x${s.size}`, type: "image/png" }))
    }, null, 2) + "\n"
  });
  out.push({ path: "favicon.svg", data: exportSvg(entry, { removeNewlines: true }) });
  return out;
}
async function buildPngs(entries, rasterize2, options = {}) {
  const size = options.size ?? 32;
  const scales = options.retina ? [1, 2] : [1];
  const out = [];
  for (const entry of entries) {
    for (const scale of scales) {
      const px = size * scale;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${entry.set.height} ${entry.set.height}" fill="${xmlEscape(options.color ?? "#000")}">` + entry.glyph.paths.map((d) => `<path d="${d}"/>`).join("") + `</svg>`;
      out.push({ path: `png/${entry.glyph.name}${scale > 1 ? `@${scale}x` : ""}.png`, data: await rasterize2(svg, px, px) });
    }
  }
  return out;
}

// ../core-export/src/layout.ts
var dirOf = (path) => path.replace(/\/+$/, "").split("/").slice(0, -1).join("/");
var clean = (path) => path.replace(/^\.\//, "").replace(/\/+/g, "/");
var styleExtension = (kind) => kind.startsWith("scss") ? "scss" : kind.startsWith("less") ? "less" : kind === "json" ? "json" : kind === "dart" ? "dart" : "css";
var styleFileName = (name, kind) => {
  const extension = styleExtension(kind);
  return extension === "scss" && kind.endsWith("variables") ? `_${name}.scss` : `${name}.${extension}`;
};
function outputConfigFor(opts) {
  const kind = opts.styleKind ?? "css";
  const stylesDir = (opts.stylesDir ?? "css").replace(/\/+$/, "");
  return {
    fonts: {
      dir: (opts.fontsDir ?? "fonts").replace(/\/+$/, ""),
      formats: opts.formats ?? ["woff2", "woff", "ttf"]
    },
    styles: [{ kind, path: `${stylesDir ? `${stylesDir}/` : ""}${styleFileName(opts.name, kind)}` }],
    ...opts.typesPath ? { types: { path: opts.typesPath } } : {}
  };
}
function relativeFontPath(stylePath, fontsDir) {
  const from = clean(dirOf(stylePath)).split("/").filter(Boolean);
  const to = clean(fontsDir).split("/").filter(Boolean);
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++;
  const up = "../".repeat(from.length - shared);
  const down = to.slice(shared).join("/");
  const joined = `${up}${down}`.replace(/\/+/g, "/");
  return joined === "" ? "./" : joined.endsWith("/") ? joined : `${joined}/`;
}

// ../core-export/src/dart.ts
function exportDart(project, build2, options = {}) {
  const family = project.preferences.font.family;
  const className = pascalCase(family) || "Icons";
  const pkg = options.package ? `
    fontPackage: '${options.package}',` : "";
  const constants = groupIcons(build2.glyphs).map(({ name, layers }) => {
    const identifierName = identifier(name);
    const code = layers[0].code;
    return `  static const IconData ${identifierName} = IconData(0x${code.toString(16)}, fontFamily: _family${options.package ? ", fontPackage: _package" : ""});`;
  });
  return `// Generated by Iconotype. Do not edit.
//
// Declare the font in pubspec.yaml:
//
//   flutter:
//     fonts:
//       - family: ${family}
//         fonts:
//           - asset: fonts/${family}.ttf
import 'package:flutter/widgets.dart';

class ${className} {
  ${className}._();

  static const String _family = '${family}';${options.package ? `
  static const String _package = '${options.package}';` : ""}
${constants.join("\n")}
}
${pkg ? "" : ""}`;
}

// ../core-export/src/outputs.ts
var escape = (code) => `\\${code.toString(16)}`;
function buildVariableBlock(project, build2, kind, fontPath) {
  const prefix = project.preferences.font.prefix;
  const icons = groupIcons(build2.glyphs);
  const rows = icons.map(({ name, layers }) => ({ name, code: layers[0].code }));
  switch (kind) {
    case "scss-variables":
      return buildVariables(project, build2, "scss", { fontPath });
    case "less-variables":
      return buildVariables(project, build2, "less", { fontPath });
    case "css-variables":
      return [
        `/* ${project.preferences.font.family} codepoints \u2014 generated by Iconotype */`,
        ":root {",
        ...rows.map((r) => `  --${prefix}${r.name}: "${escape(r.code)}";`),
        "}",
        ""
      ].join("\n");
    case "json":
      return JSON.stringify(Object.fromEntries(rows.map((r) => [r.name, r.code.toString(16)])), null, 2) + "\n";
    case "dart":
      return exportDart(project, build2);
    default:
      return "";
  }
}
async function resolveOutputs(project, options = {}) {
  const output = project.output ?? {};
  const family = project.preferences.font.family;
  const formats = output.fonts?.formats ?? ["woff2", "woff", "ttf"];
  const build2 = await buildFont(project, { formats, timestamp: options.timestamp ?? 0 });
  const files = [];
  if (output.fonts) {
    const dir = clean(output.fonts.dir).replace(/\/*$/, "/");
    for (const format of formats) {
      const data = format === "svg" ? build2.svg : build2[format];
      if (data) files.push({ path: `${dir}${family}.${format}`, data, kind: "font" });
    }
  }
  for (const style of output.styles ?? []) {
    const fontPath = output.fonts ? output.fonts.publicPath ?? relativeFontPath(style.path, output.fonts.dir) : "fonts/";
    const data = style.kind === "css" || style.kind === "scss" || style.kind === "less" ? buildCss(project, build2, { fontPath, formats, version: options.version }) : buildVariableBlock(project, build2, style.kind, fontPath);
    files.push({ path: clean(style.path), data, kind: "style" });
  }
  const entries = iconsOf(project).filter((e) => e.glyph.selected !== false);
  if (output.types) files.push({ path: clean(output.types.path), data: exportTypes(project, entries), kind: "types" });
  if (output.sprite) files.push({ path: clean(output.sprite.path), data: exportSpriteSymbols(project, entries), kind: "sprite" });
  if (output.demo) files.push({ path: clean(output.demo.path), data: buildDemoHtml(project, build2), kind: "demo" });
  return { files, build: build2 };
}

// src/load.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var svgFilesIn = (dir) => {
  const out = [];
  for (const entry of (0, import_node_fs.readdirSync)(dir)) {
    const full = (0, import_node_path.join)(dir, entry);
    if ((0, import_node_fs.statSync)(full).isDirectory()) out.push(...svgFilesIn(full));
    else if ((0, import_node_path.extname)(entry).toLowerCase() === ".svg") out.push(full);
  }
  return out.sort();
};
function loadProject(input, opts = {}) {
  const warnings = [];
  const stat = (0, import_node_fs.statSync)(input);
  let project;
  if (stat.isDirectory()) {
    const files = svgFilesIn(input);
    project = emptyProject("cli", input.replace(/\/+$/, "").split("/").pop() || "icons");
    project.sets = [{ ...emptySet("cli-set-0", "Icons"), height: opts.targetHeight ?? 1024 }];
    for (const file of files) {
      const name = file.split("/").pop();
      try {
        const result = importSvg((0, import_node_fs.readFileSync)(file, "utf8"), name, { targetHeight: project.sets[0].height });
        project.sets[0].glyphs.push(result.glyph);
        warnings.push(...result.warnings.map((w) => `${name}: ${w}`));
      } catch (e) {
        warnings.push(e.message);
      }
    }
  } else if ((0, import_node_path.extname)(input).toLowerCase() === ".zip") {
    const result = importIcoMoonZip((0, import_node_fs.readFileSync)(input));
    project = result.project;
    warnings.push(...result.warnings);
  } else {
    const data = JSON.parse((0, import_node_fs.readFileSync)(input, "utf8"));
    if (isIconFontFile(data)) {
      project = fromIconFontFile(data, input);
    } else if (isIcoMoonFile(data)) {
      const result = importIcoMoon(data);
      project = result.project;
      warnings.push(...result.warnings);
    } else if (Array.isArray(data.sets)) {
      project = data;
    } else {
      throw new Error(`${input}: not a Iconotype or IcoMoon project`);
    }
  }
  let lockPath;
  if (opts.lock) {
    try {
      project.codepoints = { ...parseLock((0, import_node_fs.readFileSync)(opts.lock, "utf8")), ...project.codepoints };
      lockPath = opts.lock;
    } catch {
    }
  }
  const missing = project.sets.filter((s) => !s.hidden).flatMap((s) => s.glyphs).filter((g) => project.codepoints[g.name] === void 0).map((g) => ({ name: g.name, layers: g.isMulticolor ? g.paths.length : 1 }));
  if (missing.length) {
    const { assignments, overflow } = allocate(project, missing);
    Object.assign(project.codepoints, assignments);
    for (const name of overflow) warnings.push(`no codepoint available for "${name}" \u2014 the Private Use Area is full`);
  }
  return { project, warnings, lockPath };
}

// src/commands.ts
var rasterize = async (svg, width) => new Uint8Array(new import_resvg_js.Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng());
var write = (root, path, data) => {
  const full = (0, import_node_path2.join)(root, path);
  (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(full), { recursive: true });
  (0, import_node_fs2.writeFileSync)(full, typeof data === "string" ? data : Buffer.from(data));
};
var defaultLockPath = (input) => (0, import_node_fs2.statSync)(input).isDirectory() ? (0, import_node_path2.join)(input, "codepoints.lock") : (0, import_node_path2.join)((0, import_node_path2.dirname)(input), "codepoints.lock");
async function build(args, io) {
  const lockPath = args.lock ?? defaultLockPath(args.input);
  const { project, warnings } = loadProject(args.input, { lock: lockPath });
  for (const w of warnings) io.error(`warning: ${w}`);
  if (!args.out && project.output) {
    const root = (0, import_node_fs2.statSync)(args.input).isDirectory() ? args.input : (0, import_node_path2.dirname)(args.input);
    const { files: files2, build: direct } = await resolveOutputs(project, { timestamp: 0 });
    for (const file of files2) write(root, file.path, file.data);
    for (const w of direct.warnings) io.error(`warning: ${w.code}: ${w.message}`);
    (0, import_node_fs2.writeFileSync)(lockPath, serializeLock(project));
    if (!args.quiet) {
      io.log(`built ${direct.glyphs.length} glyph(s) \u2192 ${files2.map((f) => f.path).join(", ")}`);
    }
    return 0;
  }
  const out = args.out ?? "dist";
  const { files, build: font } = await buildBundle(project, {
    formats: args.formats ?? ["woff2", "woff", "ttf"],
    // deterministic: identical input must produce identical bytes
    timestamp: 0,
    selectionJson: JSON.stringify(exportIcoMoonSelection(project), null, 2)
  });
  for (const f of files) write(out, f.path, f.data);
  for (const w of font.warnings) io.error(`warning: ${w.code}: ${w.message}`);
  const entries = iconsOf(project);
  if (args.sprite) {
    write(out, "sprite.svg", exportSpriteSymbols(project, entries));
    const sheet = buildSpriteSheet(project, entries);
    write(out, "sprite.png", await rasterize(sheet.svg, sheet.width, sheet.height));
    write(out, "sprite.css", sheet.css);
  }
  if (args.png) {
    for (const png of await buildPngs(entries, rasterize, { retina: true })) write(out, png.path, png.data);
  }
  if (args.favicon) {
    const entry = entries.find((e) => e.glyph.name === args.favicon);
    if (!entry) {
      io.error(`error: --favicon "${args.favicon}" is not an icon in this project`);
      return 1;
    }
    for (const f of await buildFavicons(entry, rasterize, { name: project.name })) write(out, f.path, f.data);
  }
  for (const target of args.components ?? []) {
    write(out, componentFilename(target, project), exportComponent(target, project, entries));
  }
  if (args.types) write(out, "icons.d.ts", exportTypes(project, entries));
  (0, import_node_fs2.writeFileSync)(lockPath, serializeLock(project));
  if (!args.quiet) {
    io.log(`built ${font.glyphs.length} glyph(s) from ${entries.length} icon(s) into ${out}`);
  }
  return 0;
}
async function init(args, io) {
  const { project, warnings } = loadProject(args.input);
  for (const w of warnings) io.error(`warning: ${w}`);
  const name = args.name ?? project.preferences.font.family ?? "icons";
  project.name = name;
  project.preferences.font.family = name;
  if (args.prefix) project.preferences.font.prefix = args.prefix;
  const styleKind = args.styleKind ?? "css";
  const stylesDir = (args.stylesDir ?? "css").replace(/\/+$/, "");
  project.output = outputConfigFor({
    name,
    fontsDir: args.fontsDir,
    stylesDir,
    styleKind,
    formats: args.formats,
    typesPath: args.types
  });
  const out = args.out ?? `${name}${ICONFONT_EXTENSION}`;
  (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(out) || ".", { recursive: true });
  (0, import_node_fs2.writeFileSync)(out, serializeIconFont(project));
  const icons = project.sets.reduce((n, s) => n + s.glyphs.length, 0);
  io.log(`wrote ${out} \u2014 ${icons} icon(s), fonts to ${project.output.fonts.dir}/, styles to ${stylesDir}/`);
  io.log(`next: open the folder in VSCode and run "Iconotype: Export Font", or: iconotype build --input ${out}`);
  return 0;
}
async function lint(args, io) {
  const { project } = loadProject(args.input);
  const report = [];
  const isDir = (0, import_node_fs2.statSync)(args.input).isDirectory();
  if (isDir) {
    const walk2 = (dir) => (0, import_node_fs2.readdirSync)(dir).flatMap((e) => {
      const full = (0, import_node_path2.join)(dir, e);
      return (0, import_node_fs2.statSync)(full).isDirectory() ? walk2(full) : (0, import_node_path2.extname)(e).toLowerCase() === ".svg" ? [full] : [];
    });
    for (const file of walk2(args.input).sort()) {
      const name = (0, import_node_path2.relative)(args.input, file);
      try {
        for (const f of fixSvg((0, import_node_fs2.readFileSync)(file, "utf8")).findings) {
          if (f.severity === "info") continue;
          report.push({ glyph: name, code: f.code, severity: f.severity, message: f.message });
        }
      } catch (e) {
        report.push({ glyph: name, code: "PARSE_FAILED", severity: "error", message: e.message });
      }
    }
  } else {
    for (const set of project.sets) {
      for (const glyph of set.glyphs) {
        for (const f of fixPaths(glyph.paths, { targetHeight: set.height, attrs: glyph.attrs }).findings) {
          if (f.severity === "info") continue;
          report.push({ glyph: glyph.name, code: f.code, severity: f.severity, message: f.message });
        }
      }
    }
  }
  const errors = report.filter((r) => r.severity === "error");
  const warnings = report.filter((r) => r.severity === "warning");
  if (args.json) {
    io.log(JSON.stringify({ errors: errors.length, warnings: warnings.length, findings: report }, null, 2));
  } else {
    for (const r of report) io.log(`${r.severity === "error" ? "error" : "warn "} ${r.glyph}: ${r.code} \u2014 ${r.message}`);
    io.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
  }
  if (errors.length) return 1;
  if (args.maxWarnings !== void 0 && warnings.length > args.maxWarnings) return 1;
  return 0;
}
async function fix(args, io) {
  if (!(0, import_node_fs2.statSync)(args.input).isDirectory()) {
    io.error("error: fix operates on a directory of .svg files");
    return 1;
  }
  const walk2 = (dir) => (0, import_node_fs2.readdirSync)(dir).flatMap((e) => {
    const full = (0, import_node_path2.join)(dir, e);
    return (0, import_node_fs2.statSync)(full).isDirectory() ? walk2(full) : (0, import_node_path2.extname)(e).toLowerCase() === ".svg" ? [full] : [];
  });
  let changed = 0;
  for (const file of walk2(args.input).sort()) {
    const source = (0, import_node_fs2.readFileSync)(file, "utf8");
    const result = fixSvg(source, {
      simplifyTolerance: args.simplify ?? 0,
      snapGrid: args.snap ?? 0,
      fit: args.refit ? "contain" : "none"
    });
    if (!result.paths.length) {
      io.error(`skipped ${(0, import_node_path2.relative)(args.input, file)}: nothing drawable`);
      continue;
    }
    const fixed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">` + result.paths.map((d, i) => {
      const fill = result.attrs[i]?.fill;
      return `<path${fill ? ` fill="${fill}"` : ""} d="${d}"/>`;
    }).join("") + `</svg>
`;
    if (fixed === source) continue;
    changed++;
    if (args.write) (0, import_node_fs2.writeFileSync)(file, fixed);
    else io.log(`would fix ${(0, import_node_path2.relative)(args.input, file)}`);
  }
  io.log(args.write ? `fixed ${changed} file(s)` : `${changed} file(s) would change (pass --write to apply)`);
  return 0;
}
var codeString = (v) => v === void 0 ? "\u2014" : (Array.isArray(v) ? v : [v]).map((c) => `U+${hex(c)}`).join(" ");
var glyphMap = (project) => {
  const out = /* @__PURE__ */ new Map();
  for (const set of project.sets) for (const g of set.glyphs) out.set(g.name, g.paths.join(""));
  return out;
};
function diffProjects(before, after) {
  const added = [];
  const removed = [];
  const moved = [];
  const changed = [];
  const beforeGlyphs = glyphMap(before);
  const afterGlyphs = glyphMap(after);
  for (const [name, code] of Object.entries(after.codepoints)) {
    const old = before.codepoints[name];
    if (old === void 0) added.push({ name, to: code });
    else if (JSON.stringify(old) !== JSON.stringify(code)) moved.push({ name, from: old, to: code });
  }
  for (const [name, code] of Object.entries(before.codepoints)) {
    if (after.codepoints[name] === void 0) removed.push({ name, from: code });
  }
  for (const [name, paths2] of afterGlyphs) {
    const old = beforeGlyphs.get(name);
    if (old !== void 0 && old !== paths2) changed.push(name);
  }
  const sort = (a, b) => a.name.localeCompare(b.name);
  return {
    added: added.sort(sort),
    removed: removed.sort(sort),
    moved: moved.sort(sort),
    changed: changed.sort(),
    breaking: removed.length > 0 || moved.length > 0
  };
}
async function diff(args, io) {
  const before = loadProject(args.before).project;
  const after = loadProject(args.after).project;
  const result = diffProjects(before, after);
  if (args.json) {
    io.log(JSON.stringify(result, null, 2));
  } else {
    for (const e of result.added) io.log(`added    ${e.name} ${codeString(e.to)}`);
    for (const e of result.removed) io.log(`REMOVED  ${e.name} ${codeString(e.from)}`);
    for (const e of result.moved) io.log(`MOVED    ${e.name} ${codeString(e.from)} -> ${codeString(e.to)}`);
    for (const name of result.changed) io.log(`changed  ${name} (same codepoint, new artwork)`);
    io.log(
      `${result.added.length} added, ${result.removed.length} removed, ${result.moved.length} moved, ${result.changed.length} redrawn`
    );
    if (result.breaking) {
      io.error("BREAKING: a removed or moved codepoint changes what existing builds render.");
    }
  }
  return result.breaking && !args.allowBreaking ? 1 : 0;
}
var SOURCE_EXTENSIONS = /* @__PURE__ */ new Set([
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".less",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".vue",
  ".svelte",
  ".astro",
  ".md",
  ".mdx",
  ".php",
  ".erb",
  ".hbs",
  ".xml"
]);
var IGNORED_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", "build", "coverage", ".svelte-kit", ".next"]);
function scanSources(root, names, prefix, skip = /* @__PURE__ */ new Set()) {
  const counts = new Map(names.map((n) => [n, 0]));
  const walk2 = (dir) => (0, import_node_fs2.readdirSync)(dir).flatMap((entry) => {
    if (IGNORED_DIRS.has(entry)) return [];
    const full = (0, import_node_path2.join)(dir, entry);
    if ((0, import_node_fs2.statSync)(full).isDirectory()) return walk2(full);
    return SOURCE_EXTENSIONS.has((0, import_node_path2.extname)(entry).toLowerCase()) ? [full] : [];
  });
  for (const file of walk2(root)) {
    if (skip.has((0, import_node_path2.resolve)(file))) continue;
    const text = (0, import_node_fs2.readFileSync)(file, "utf8");
    for (const name of names) {
      const pattern = new RegExp(`(?:${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      const hits = text.match(pattern);
      if (hits) counts.set(name, (counts.get(name) ?? 0) + hits.length);
    }
  }
  return counts;
}
async function scan(args, io) {
  const { project } = loadProject(args.input);
  const entries = iconsOf(project);
  const names = entries.map((e) => e.glyph.name);
  const counts = scanSources(args.source, names, project.preferences.font.prefix, generatedPaths(project, args.input));
  const unused = names.filter((n) => (counts.get(n) ?? 0) === 0).sort();
  if (args.json) {
    io.log(JSON.stringify({
      total: names.length,
      used: names.length - unused.length,
      unused,
      counts: Object.fromEntries(counts)
    }, null, 2));
  } else {
    for (const name of unused) io.log(`unused   ${name}`);
    io.log(`${names.length - unused.length}/${names.length} icon(s) referenced in ${args.source}`);
    if (unused.length) io.log(`subset with: iconotype build --input ${args.input} --only ${names.filter((n) => !unused.includes(n)).join(",")}`);
  }
  return args.failOnUnused && unused.length ? 1 : 0;
}
function generatedPaths(project, input) {
  const root = (0, import_node_fs2.statSync)(input).isDirectory() ? input : (0, import_node_path2.dirname)(input);
  const out = /* @__PURE__ */ new Set();
  const add = (rel) => {
    if (rel) out.add((0, import_node_path2.resolve)(root, rel));
  };
  for (const style of project.output?.styles ?? []) add(style.path);
  add(project.output?.types?.path);
  add(project.output?.sprite?.path);
  add(project.output?.demo?.path);
  return out;
}
async function info(args, io) {
  const { project, warnings } = loadProject(args.input);
  const font = await buildFont(project, { formats: ["ttf"], timestamp: 0 });
  const summary = {
    name: project.name,
    family: project.preferences.font.family,
    sets: project.sets.map((s) => ({ name: s.name, glyphs: s.glyphs.length, height: s.height, hidden: s.hidden })),
    icons: iconsOf(project).length,
    glyphs: font.glyphs.length,
    emSize: font.metrics.unitsPerEm,
    ttfBytes: font.ttf?.byteLength ?? 0,
    warnings: warnings.length
  };
  if (args.json) {
    io.log(JSON.stringify(summary, null, 2));
  } else {
    io.log(`${summary.name} \u2014 family "${summary.family}", em ${summary.emSize}`);
    for (const set of summary.sets) {
      io.log(`  ${set.hidden ? "(hidden) " : ""}${set.name}: ${set.glyphs} glyph(s) at ${set.height} units`);
    }
    io.log(`  ${summary.icons} icon(s) \u2192 ${summary.glyphs} glyph(s), ${(summary.ttfBytes / 1024).toFixed(1)} kB ttf`);
  }
  return 0;
}

// src/cli.ts
var USAGE = `iconotype \u2014 icon font toolchain

usage: iconotype <command> [options]

commands:
  init      create a committed .iconotype.json from an existing project or SVG folder
  build     build the font package from a project or a folder of SVGs
  lint      report what the fixer would have to change; non-zero exit on errors
  fix       rewrite source SVGs through the fixer pipeline
  diff      compare two projects; non-zero exit when the change is BREAKING
  scan      find which icons a codebase actually references
  info      summarise a project

common options:
  -i, --input <path>     project .json, IcoMoon .zip, or a directory of .svg  (default: icons)
      --json             machine-readable output
  -h, --help             show this

build options:
      --out <dir>        package everything into this directory. Omit it and a project
                         with an "output" block writes to the paths it names instead.
      --lock <file>      codepoints.lock to read and update            (default: next to --input)
      --formats <list>   woff2,woff,ttf,svg                            (default: woff2,woff,ttf)
      --components <l>   react,vue,svelte,webcomponent,elm
      --sprite           also emit sprite.svg, sprite.png and sprite.css
      --png              also emit one PNG per icon, at 1x and 2x
      --favicon <name>   build a favicon set from that icon
      --types            emit icons.d.ts with a union of every icon name

init options:
      --out <file>       where to write it                (default: <name>.iconotype.json)
      --name <name>      font family, class prefix root   (default: from the source)
      --prefix <p>       class prefix, e.g. app- \u2014 this is what autocompletion triggers
                         on. Defaults to the source project's, so existing markup keeps
                         working after an import.
      --fonts-dir <dir>  where a build writes font files  (default: fonts)
      --styles-dir <dir> where a build writes styles      (default: css)
      --style-kind <k>   css | scss-variables | css-variables | dart | \u2026  (default: css)
      --types-file <f>   also emit a .d.ts of every icon name
                         (build's --types is a boolean, hence the different name)

lint options:
      --max-warnings <n> fail when there are more warnings than this

fix options:
      --write            apply the changes (otherwise it is a dry run)
      --simplify <n>     path simplification tolerance                 (default: 0)
      --snap <n>         snap coordinates to an n-unit grid            (default: 0)
      --refit            scale and centre the artwork in the em box

diff options:
      --allow-breaking   report a breaking change but exit 0 anyway

scan options:
      --source <dir>     the codebase to search                        (default: src)
      --fail-on-unused   exit non-zero when an icon is never referenced

examples:
  iconotype init --input icomoon/selection.json --name app       --fonts-dir app/fonts --styles-dir app/css --style-kind scss-variables
  iconotype build --input icons --out dist --components svelte --types
  iconotype lint --input icons --max-warnings 0
  iconotype diff dist/selection.json icons --allow-breaking
  iconotype scan --input icons --source src --json
`;
var list = (v) => v === void 0 ? void 0 : v.split(",").map((s) => s.trim()).filter(Boolean);
async function run(argv, io) {
  const command = argv[0];
  if (!command || command === "--help" || command === "-h" || command === "help") {
    io.log(USAGE);
    return command ? 0 : 1;
  }
  let parsed;
  try {
    parsed = (0, import_node_util.parseArgs)({
      args: argv.slice(1),
      allowPositionals: true,
      options: {
        input: { type: "string", short: "i" },
        out: { type: "string" },
        lock: { type: "string" },
        formats: { type: "string" },
        components: { type: "string" },
        favicon: { type: "string" },
        source: { type: "string" },
        simplify: { type: "string" },
        snap: { type: "string" },
        "max-warnings": { type: "string" },
        name: { type: "string" },
        prefix: { type: "string" },
        "fonts-dir": { type: "string" },
        "styles-dir": { type: "string" },
        "style-kind": { type: "string" },
        "types-file": { type: "string" },
        sprite: { type: "boolean" },
        png: { type: "boolean" },
        types: { type: "boolean" },
        write: { type: "boolean" },
        refit: { type: "boolean" },
        json: { type: "boolean" },
        quiet: { type: "boolean", short: "q" },
        "allow-breaking": { type: "boolean" },
        "fail-on-unused": { type: "boolean" },
        help: { type: "boolean", short: "h" }
      }
    });
  } catch (e) {
    io.error(`error: ${e.message}`);
    return 2;
  }
  const { values: v, positionals } = parsed;
  if (v.help) {
    io.log(USAGE);
    return 0;
  }
  const input = v.input ?? positionals[0] ?? "icons";
  const num2 = (s) => s === void 0 ? void 0 : Number(s);
  try {
    switch (command) {
      case "init":
        return await init({
          input,
          out: v.out,
          name: v.name,
          prefix: v.prefix,
          fontsDir: v["fonts-dir"],
          stylesDir: v["styles-dir"],
          styleKind: v["style-kind"],
          formats: list(v.formats),
          types: v["types-file"]
        }, io);
      case "build":
        return await build({
          input,
          out: v.out,
          lock: v.lock,
          formats: list(v.formats),
          components: list(v.components),
          sprite: v.sprite,
          png: v.png,
          favicon: v.favicon,
          types: v.types,
          quiet: v.quiet
        }, io);
      case "lint":
        return await lint({ input, json: v.json, maxWarnings: num2(v["max-warnings"]) }, io);
      case "fix":
        return await fix({ input, write: v.write, simplify: num2(v.simplify), snap: num2(v.snap), refit: v.refit }, io);
      case "diff": {
        const before = v.input ?? positionals[0];
        const after = v.input ? positionals[0] : positionals[1];
        if (!before || !after) {
          io.error("error: diff needs two projects \u2014 iconotype diff <before> <after>");
          return 2;
        }
        return await diff({ before, after, json: v.json, allowBreaking: v["allow-breaking"] }, io);
      }
      case "scan":
        return await scan({ input, source: v.source ?? "src", json: v.json, failOnUnused: v["fail-on-unused"] }, io);
      case "info":
        return await info({ input, json: v.json }, io);
      default:
        io.error(`error: unknown command "${command}"
`);
        io.log(USAGE);
        return 2;
    }
  } catch (e) {
    io.error(`error: ${e.message}`);
    return 1;
  }
}
if (process.argv[1]?.includes("iconotype")) {
  const io = { log: (m) => console.log(m), error: (m) => console.error(m) };
  run(process.argv.slice(2), io).then((code) => {
    process.exitCode = code;
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  run
});
