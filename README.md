# DupeFinder Revamp

DupeFinder Revamp is a client-side plugin for
[Stash](https://github.com/stashapp/stash) that finds duplicate scenes and
multi-file scenes, then helps you review, split, merge, or clean them up.

This project began with the DupeFinder plugin from
[zzzinsCode/stashapp-plugins](https://github.com/zzzinsCode/stashapp-plugins),
but has since been substantially rewritten. The new name distinguishes this
version and its behavior from the original plugin. Its plugin ID is
`DupeFinderRevamp`; the JavaScript filename prefix remains `DupeFinder`.

---

## Features

- **Duplicate detection modes** — use pHash-first matching with an optional legacy fallback for scenes without pHash, or use legacy-only title/date/studio matching
- **Multi-file scene detection** — find scenes that have more than one attached file
- **Explicit keep selection** — click a file or scene row to choose what remains; click a selected multi-file row again to clear the selection
- **Keep, split, and merge actions** — clean a multi-file scene, split its files into separate scenes, or merge duplicate scenes into the selected keeper
- **Batch mode** — apply Keep or Split to included multi-file scenes and Merge to included duplicate groups
- **Safety filtering** — scenes and groups with large duration differences can start excluded from batch operations
- **Preview mode** — inspect destructive operations before executing them
- **Automatic keep selection** — rank candidates by balanced, quality, or size-based rules
- **Progress and abort controls** — see batch progress and stop remaining work after the current item finishes
- **Native Stash launchers** — always available in **Settings → Tools**, with an optional header icon enabled by default
- **Documentation shortcut** — open **?** in the plugin header to view the project README on GitHub
- **No Python dependency** — all processing runs in the Stash frontend

---

## Installation

### Stash plugin source — recommended

1. Open **Settings → Plugins** in Stash.
2. Under **Available Plugins**, add this source:

   ```text
   https://lucasnegrao.github.io/stashapp-plugins/main/index.yml
   ```

3. Reload the available plugins if necessary.
4. Install **DupeFinder Revamp**.
5. Open it from **Settings → Tools → DupeFinder Revamp** or from the layers icon in the main header.

Updates published by the source will appear in Stash's plugin manager.

### Upgrading from the pre-rebrand build

Early development builds used `DupeFinder.yml` and the `DupeFinder` plugin ID.
Remove or disable that build before installing `DupeFinderRevamp.yml`; otherwise
Stash can load both plugins and show duplicate launchers. The directory name
does not define the plugin ID—the YAML filename does.

### Release ZIP

1. Download `DupeFinder-Revamp-vX.Y.Z.zip` from the
   [latest GitHub release](https://github.com/lucasnegrao/stashapp-plugin-dupefinder-revamp/releases/latest).
2. Extract its `DupeFinderRevamp` directory into your Stash plugins directory.
3. Confirm that the resulting layout contains:

   ```text
   plugins/
   └── DupeFinderRevamp/
       ├── DupeFinderRevamp.yml
       ├── DupeFinder.js
       └── ...
   ```

4. In Stash, open **Settings → Plugins** and select **Reload Plugins**.

The default plugin directory is the `plugins` directory beside the Stash
configuration file. Your configured plugin path may be different.

### Git checkout

```bash
git clone https://github.com/lucasnegrao/stashapp-plugin-dupefinder-revamp.git DupeFinderRevamp
```

Place the resulting `DupeFinderRevamp` directory inside your configured Stash
plugins directory, then reload plugins.

---

## Usage

1. Open **DupeFinder Revamp** from **Settings → Tools** or select its layers icon in the Stash header.
2. Wait while the plugin loads the scenes in your library.
3. Optionally enable **PREVIEW** before testing destructive actions.
4. Optionally enable **BATCH** to operate on multiple included scenes or groups.
5. Choose `pHash` or `Legacy` matching in the header. In pHash mode, choose the desired distance preset.
6. Open **⚙** for automatic selection and safety settings, or **?** to open the project documentation on GitHub.

### Multi-file tab

The Multi-file tab lists scenes with more than one attached file. Click a file
row to select the file to keep. Click the selected row again to clear the keep
selection.

- **Keep** preserves the selected file on the current scene and permanently deletes its other files from disk. Keep is disabled when no file is selected.
- **Split** preserves the selected file and its current scene metadata, then moves every other file into a new scene with no copied metadata.
- If no keep file is selected, **Split** moves every file into a new scene with no copied metadata, then removes the original scene and its metadata without deleting its files.
- In Batch mode, exclude anything you do not want processed, then run Keep or Split across the remaining eligible scenes.

### Duplicates tab

The Duplicates tab displays groups produced by the active matching mode. Click
a scene row to select the keeper.

- **Merge** combines metadata into the selected keep scene.
- Non-keeper scenes and all files belonging to them are then permanently deleted.
- Files already attached to the keep scene remain in place.
- In Batch mode, exclude groups you do not want processed, then run Merge.

---

## Duplicate detection

In **pHash** mode, the plugin asks Stash for pHash duplicate groups at the
selected Hamming-distance preset. If **Use legacy when files have no pHash** is
enabled, scenes without a pHash also pass through the legacy matcher.

In **Legacy** mode, matching uses normalized titles and/or matching date and
studio metadata. Scenes with neither a usable title nor a date-and-studio
combination are excluded from legacy duplicate detection.

The pHash presets are:

- **Exact** — all pHash bits must match
- **High** — up to 4 differing bits
- **Medium** — up to 8 differing bits
- **Low** — up to 10 differing bits

The numeric distances are intentionally omitted from the main interface and
shown here for reference.

---

## Settings

The **⚙** dialog provides:

- **Legacy title distance** — controls how far normalized titles may differ in legacy matching
- **Automatic keep selection** — chooses Balanced, Quality, or Size ranking
- **Maximum duration difference** — sets the threshold used by batch safety checks
- **Auto-exclude unsafe duplicate groups** — starts risky groups outside the batch
- **Use legacy when files have no pHash** — enables the legacy fallback during pHash matching
- **Prefer organized scenes** — uses organized status as a tie-break when selecting the best scene

The Stash plugin settings page also provides **Show DupeFinder Revamp in
header**. Disabling it hides only the header launcher; the Tools launcher
remains available.

### Codec ranking

When codec quality is considered, the order from best to worst is:

```text
av1 → hevc / h265 → vp9 → h264 / avc → mpeg4 → mpeg2
```

---

## Safety notes

- Keep and Merge can permanently delete video files from disk.
- Split changes scene/file associations and may delete the original scene metadata when no keeper is selected.
- Preview mode does not change your library and should be used before unfamiliar operations.
- Aborting a batch stops only the remaining items. Completed actions are not undone.
- Loading time grows with the size of the Stash library.
- Back up your Stash database before performing large cleanup operations.

---

## Development

The plugin is intentionally dependency-free at runtime. Its source files stay
at the repository root. The manifest filename defines the `DupeFinderRevamp`
plugin ID; the JavaScript filenames do not affect that identity.

Run the available JavaScript tests with:

```bash
node --test tests/*.test.js
```

Release tags must match the version in `DupeFinderRevamp.yml`, prefixed with `v`.
For example, version `1.1.0` is released with tag `v1.1.0`.
