# DupeFinder

A [Stash](https://github.com/stashapp/stash) plugin that finds duplicate scenes and multi-file scenes in your library, and lets you merge or delete them directly from a modal.

---

## Features

- **Duplicate detection modes** — switch between pHash-first matching with a legacy fallback pass only for scenes without pHash, or legacy-only title/date/studio matching
- **Multi-file scene detection** — finds scenes that have more than one file attached
- **Click-to-keep selection** — click any file row or duplicate-scene row to choose exactly what should be kept
- **Consistent keep labeling** — the selected keeper is always marked **keep** so the UI reflects your choice
- **Batch mode for both tabs** — exclude any scene/group from the batch, then apply keep or merge to everything still included
- **Safer batch defaults** — multi-file scenes and duplicate groups with large duration diffs start excluded from batch mode until you explicitly confirm them
- **Immediate duplicate controls** — switch duplicate mode and pHash distance from the main modal header; changes save and refresh results automatically
- **Settings modal** — configure legacy fallback distance, best-selection algorithm, maximum duration difference, and additional behavior toggles
- **Stable table layout** — fixed-width columns on both tabs with Actions first, plus pHash on both tables and Duration in duplicates
- **Keep selected file cleanup** — in the Multi-file tab, keep the selected file and delete the rest without deleting the scene
- **Split multi-file scenes** — unmerge a scene by keeping the selected file on the original scene and moving each other file into its own new scene
- **Merge duplicates into selected keep** — in the Duplicates tab, combine metadata into the selected keep scene and delete every non-keeper scene and its files
- **Dry run / preview mode** — preview cleanup, merge, and batch actions before anything destructive happens
- **Batch progress + abort** — batch runs lock the modal, show progress, and can abort the remaining items without undoing completed actions
- **Native Stash launchers** — always available under **Settings → Tools**, with an optional icon-only header button enabled by default
- **No Python required** — pure JavaScript, client-side only

---

## Installation

1. Copy the `DupeFinder` folder into your Stash plugins directory:
   ```
   C:\Users\<you>\.stash\plugins\DupeFinder\
   ```
2. In Stash, go to **Settings → Plugins** and click **Reload Plugins**
3. Open **Settings → Tools → DupeFinder**; an icon-only DupeFinder button also appears in the Stash header by default
4. To hide the header icon, disable **Show DupeFinder in header** in **Settings → Plugins → DupeFinder**. The Tools entry remains available.

---

## Usage

1. Open **DupeFinder** from **Settings → Tools**, or click its search icon in the Stash header
2. The plugin loads all scenes from your library (progress shown while loading)
3. Optional: press **PREVIEW** in the modal header to preview destructive actions before executing them
4. Optional: press **BATCH** to work through many scenes/groups at once while excluding anything you want to skip
5. Choose duplicate mode and, in pHash mode, pHash distance directly from the modal header; changes refresh the results automatically
6. Optional: open **⚙** to tune ranking, legacy fallback, and batch safety behavior
7. Two tabs are shown:

### Multi-file tab
Lists every scene that has more than one file attached, sorted by file count. Click a file row to choose which file to **keep**. The selected file is highlighted and marked **keep**.

Available actions:
- **🧹 Keep** — keeps the currently selected file, safely makes it the scene's primary file if needed, and deletes the other files from disk
- **✂ Split** — keeps the selected file on the current scene and creates new scenes for the remaining files using copied scene metadata
- In **Batch mode**, exclude any scenes you want to skip, then run **Keep selected in batch** to apply the chosen keep file across all included scenes
- Scenes whose file durations differ by more than the configured safety threshold start **Excluded** in batch mode and ask for confirmation before being re-added
- In **Dry run / preview mode**, these actions show what would be kept or deleted without making changes

### Duplicates tab
Lists groups of scenes using the selected duplicate finder mode. In **pHash** mode, scenes match by pHash distance first and only scenes without pHash then go through the legacy title/date/studio matcher. In **Legacy** mode, all duplicate matching uses the legacy matcher. Click any scene row to choose the scene to **keep** before merging.

Available actions:
- **⚡ Merge** — combines metadata into the currently selected keep scene, then deletes every non-keeper scene and its files from disk; the keep scene's existing files are preserved
- In **Batch mode**, exclude any groups you want to skip, then run **Merge selected in batch** to process all included groups
- Unsafe groups (large duration differences) can start excluded in batch mode and require explicit confirmation before inclusion
- While a batch is running, the modal shows progress, disables other interactions, and lets you abort the remaining items only
- In **Dry run / preview mode**, merge and batch actions preview the destination keeper plus every source scene and file that would be removed

---

## How duplicates are detected

Two scenes are considered duplicates when:
- In **pHash** mode, their pHashes are within the configured Hamming distance, or they have no pHash and the legacy matcher decides they match
- In **Legacy** mode, the legacy matcher decides they match based on title and/or date+studio

The duplicate mode controls are in the main modal header:
- **Mode** switches between `pHash` and `Legacy` and refreshes results immediately
- **pHash distance** appears in pHash mode and uses presets: `Exact (0)`, `High (4)`, `Medium (8)`, `Low (10)`

Additional settings can be tuned in **⚙**:
- **Legacy title distance** controls the Levenshtein fallback used by legacy mode and by the no-pHash fallback pass in pHash mode
- **Maximum duration difference** offers `Any`, `Equal`, `1 s`, `5 s`, and `10 s` for batch safety filtering

Legacy fallback scenes with no title and no date+studio combination are excluded from duplicate detection.

---

## Codec ranking (best → worst)

`av1` → `hevc / h265` → `vp9` → `h264 / avc` → `mpeg4` → `mpeg2`

---

## Notes

- Loading time scales with library size — large libraries (10,000+ scenes) may take a few seconds
- Keep, merge, delete, and batch actions are permanent and cannot be undone from within the plugin unless you first use **Dry run / preview mode** to inspect them
- Aborting a batch only stops the remaining items; anything already kept, merged, or deleted stays changed
- The Tools launcher is always available; only the header icon is controlled by the plugin setting
