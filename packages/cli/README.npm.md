# iconotype

Build, fix and export icon fonts from the command line. Imports IcoMoon projects,
selections, font packages and folders of SVG.

```bash
# turn an existing IcoMoon project into a committed one
npx @iconotype/cli init --input icomoon/project.json \
  --fonts-dir app/fonts --styles-dir app/css --style-kind scss-variables

# build it wherever the project file says to
npx @iconotype/cli build --input app.iconotype.json

# check nothing moved
npx @iconotype/cli diff --input app.iconotype.json --against origin/main
```

Builds are deterministic: the same project produces the same bytes, so a font built on
a laptop and a font built on a runner are identical. Codepoints are append-only and
recorded in `codepoints.lock`, because a codepoint is the font's API — renaming an icon
moves its name, never its number.

Also available as a web app, a desktop app and a VSCode extension:
<https://github.com/iconotype/iconotype>.

MIT.
