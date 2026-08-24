<script lang="ts">
  /**
   * The app mark: the em square with the punch-cut I standing in it.
   *
   * A shrunk copy of `mark.svg` with the layout guides dropped — at 16px the dashed
   * baselines turn to mud and all that survives is noise around the letter. Inert to
   * the pointer, so a click on it lands on whatever encloses it: in the title bar that
   * is the drag region, and an SVG that swallowed the press made a dead spot exactly
   * where a window is easiest to grab.
   */
  let { size = 16 }: { size?: number } = $props()
</script>

<svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="iconotype-mark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7c7ff5" />
      <stop offset="1" stop-color="#4f46e5" />
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="224" fill="url(#iconotype-mark)" />
  <g fill="#ffffff">
    <rect x="336" y="288" width="352" height="86" rx="12" />
    <rect x="452" y="288" width="120" height="448" rx="12" />
    <rect x="336" y="650" width="352" height="86" rx="12" />
  </g>
</svg>

<style>
  svg { display: block; pointer-events: none; border-radius: 3px; }
</style>
