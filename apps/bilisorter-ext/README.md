# bilisorter-ext

Chrome Extension (Manifest V3) — the main BiliSorter application.

See [root README](../../README.md) for full documentation and [docs/research.md](../../docs/research.md) for technical details.

## Development

```bash
pnpm install
pnpm dev        # Dev mode with HMR
pnpm build      # Production build → dist/
```

Load the `dist/` folder as an unpacked extension at `chrome://extensions/`.
