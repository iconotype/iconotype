# 06 — Import / export formats

## IcoMoon project JSON — verified schema

Reverse-engineered from a real file (`alpimaps.json`, 3 sets, 25 glyphs). **Two distinct shapes exist**; support both.

### A. Project file (`File → Save`, what the user hands us)

```jsonc
{
  "metadata": { "name": "alpimaps", "lastOpened": 0, "created": 1667827684944 },
  "uid": -1,
  "iconSets": [
    {
      "id": 0,
      "metadata": {
        "name": "Material Icons (subset)",
        "url": "https://material.io/resources/icons",
        "designer": "Google", "designerURL": "https://design.google",
        "license": "Apache License Version 2.0",
        "licenseURL": "https://www.apache.org/licenses/LICENSE-2.0.txt",
        "iconsHash": 2049387245,
        "importSize": { "width": 24, "height": 24 }
      },
      "height": 1024,          // em height the paths are expressed in
      "prevSize": 32,          // preview size in the grid
      "invisible": false,      // set enable/disable toggle
      "colorThemes": [],       // [[ [r,g,b,a], … ], …]  per-theme palette
      "colorThemeIdx": 0,      // present only when themes exist
      "icons": [
        {
          "id": 0,
          "paths": ["M418 380l-120 602h90…"],   // one entry per color layer
          "attrs": [{}],                          // parallel: [{ "fill": "rgb(68,68,68)" }, …]
          "isMulticolor": false,
          "isMulticolor2": false,
          "tags": ["directions_walk"],            // first tag = display name
          "grid": 24                              // 0 = "no grid"
        }
      ],
      "selection": [
        { "order": 1, "id": 0, "name": "directions_walk",
          "prevSize": 24, "code": 59664, "tempChar": "" }
        // multicolor entries additionally carry: "codes": [59665, 59666, …]
      ]
    }
  ],
  "preferences": {
    "showGlyphs": true, "showCodes": true, "showQuickUse": true,
    "showQuickUse2": true, "showSVGs": true,
    "fontPref": {
      "prefix": "icon-",
      "metadata": { "fontFamily": "alpimaps", "majorVersion": 1, "minorVersion": 0 },
      "metrics": { "emSize": 512, "baseline": 6.25, "whitespace": 50 },
      "embed": false, "showSelector": true, "showMetrics": true,
      "cssVars": true, "cssVarsFormat": "scss"
    },
    "imagePref": {
      "prefix": "icon-", "png": true, "useClassSelector": true,
      "color": 0, "bgColor": 16777215, "name": "icomoon", "classSelector": ".icon"
    },
    "historySize": 50,
    "gridSize": 16
  }
}
```

Notes learned from the real file:
- `icons[]` and `selection[]` are **parallel arrays joined by `id`**, not nested. Order in the UI comes from `selection[].order`.
- `code` is decimal (59664 = `0xE910`) and matches the codes shown in IcoMoon's UI.
- `height` (1024) is the path coordinate space; `metrics.emSize` (512) is the *output* font em. They differ — scale on export.
- `grid: 0` means the icon has no source grid; skip grid-snapping for it.
- Multicolor: `attrs[i].fill` gives the layer color, `colorThemes` gives selectable palettes, `selection[].codes` gives one codepoint per layer.
- `iconsHash` is IcoMoon's dedupe/update key for library sets — preserve, do not recompute.

### B. `selection.json` (inside a downloaded font zip)

```jsonc
{
  "IcoMoonType": "selection",
  "icons": [ { "icon": { paths, attrs, tags, grid, isMulticolor… },
               "attrs": [], "properties": { order, id, name, prevSize, code, ligatures },
               "setIdx": 0, "setId": 1, "iconIdx": 0 } ],
  "height": 1024,
  "metadata": { "name": "icomoon" },
  "preferences": { … same as above … }
}
```

### C. `IcoMoonType: "iconSet"` — library set export. Same as one `iconSets[]` entry.

**Import rule: keep unknown keys.** Store the raw source object per set/glyph in `_icomoon` so re-export is lossless.

## Other importers

| Source | Pri | Notes |
|---|---|---|
| SVG files / folder / drag-drop / clipboard | P0 | runs the [04](04-svg-normalization.md) pipeline |
| IcoMoon zip (selection.json + fonts) | P0 | |
| Fontello `config.json` | P1 | close cousin: `glyphs[].{uid,css,code,src,svg{path,width}}` |
| Font file (TTF/OTF/WOFF/WOFF2) → glyphs | P1 | `opentype.js` / `fontkit`; recovers a font whose source was lost. Big selling point. |
| Iconify (`@iconify/json`, or API) | P2 | carries license + author per icon |
| Figma (REST API, node export) | P2 | needs a token; desktop/VSCode only |
| SVG sprite (`<symbol>` sheet) | P1 | |
| Nerd Fonts / Material Symbols codepoint maps | P2 | |

## Exporters

See [03 §8](03-features.md). Two rules:

1. Always emit an IcoMoon-compatible `selection.json` alongside our own manifest — no lock-in, and it lets users bounce between tools.
2. Every text output is deterministic and passes the format options: `add <title>`, `prepend names to IDs`, `fixed size`, `add all color palettes`, `remove newlines`, `use tabs`, `indentation size`.
