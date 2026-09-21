# DupeFinder

A [Stash](https://github.com/stashapp/stash) plugin that finds duplicate scenes and multi-file scenes in your library, and lets you merge or delete them directly from a floating modal — no page navigation required.

---

## Features

- **Duplicate detection** — uses pHash distance first, with the original metadata/title matcher kept as a legacy fallback for scenes without pHash
- **Multi-file scene detection** — finds scenes that have more than one file attached
- **Click-to-keep selection** — click any file row or duplicate-scene row to choose exactly what should be kept
- **Consistent keep labeling** — the selected keeper is always marked **keep** so the UI reflects your choice
- **Batch mode for both tabs** — exclude any scene/group from the batch, then apply keep or merge to everything still included
- **Safer batch defaults** — multi-file scenes and duplicate groups with large duration diffs start excluded from batch mode until you explicitly confirm them
- **Settings modal** — configure pHash distance, legacy fallback distance, best-selection algorithm, batch safety threshold, and additional behavior toggles
- **Stable table layout** — fixed-width columns on both tabs with Actions first, plus pHash on both tables and Duration in duplicates
- **Keep selected file cleanup** — in the Multi-file tab, keep the selected file and delete the rest without deleting the scene
- **Split multi-file scenes** — unmerge a scene by keeping the selected file on the original scene and moving each other file into its own new scene
- **Merge duplicates into selected keep** — in the Duplicates tab, merge the rest of the group into the selected keep scene
- **Dry run / preview mode** — preview cleanup, delete, merge, and batch actions before anything destructive happens
- **Batch progress + abort** — batch runs lock the modal, show progress, and can abort the remaining items without undoing completed actions
- **Delete scenes** — delete individual scenes (and their files from disk) directly from the results
- **Floating button** — accessible from anywhere in Stash via a persistent 🔍 Dupes button
- **No Python required** — pure JavaScript, client-side only

---

## Installation

1. Copy the `DupeFinder` folder into your Stash plugins directory:
   ```
   C:\Users\<you>\.stash\plugins\DupeFinder\
   ```
2. In Stash, go to **Settings → Plugins** and click **Reload Plugins**
3. A **🔍 Dupes** button will appear in the bottom-left of every Stash page

---

## Usage

1. Click **🔍 Dupes** anywhere in Stash
2. The plugin loads all scenes from your library (progress shown while loading)
3. Optional: enable **Dry run / preview mode** in the modal header to preview destructive actions before executing them
4. Optional: enable **Batch mode** to work through many scenes/groups at once while excluding anything you want to skip
5. Optional: open **⚙** in the modal header to tune grouping/ranking behavior and safety defaults
6. Two tabs are shown:

### Multi-file tab
Lists every scene that has more than one file attached, sorted by file count. Click a file row to choose which file to **keep**. The selected file is highlighted and marked **keep**.

Available actions:
- **🧹 Keep** — keeps the currently selected file, safely makes it the scene's primary file if needed, and deletes the other files from disk
- **✂ Split** — keeps the selected file on the current scene and creates new scenes for the remaining files using copied scene metadata
- **🗑 Delete scene** — deletes the whole scene and all its files
- In **Batch mode**, exclude any scenes you want to skip, then run **Keep selected in batch** to apply the chosen keep file across all included scenes
- Scenes whose file durations differ by more than the configured safety threshold start **Excluded** in batch mode and ask for confirmation before being re-added
- In **Dry run / preview mode**, these actions show what would be kept or deleted without making changes

### Duplicates tab
Lists groups of scenes that match by pHash distance. If a scene has no pHash, it falls back to the legacy title/date/studio matcher. Click any scene row to choose the scene to **keep** before merging.

Available actions:
- **⚡ Merge** — merges the rest of the selected duplicate group into the currently selected keep scene, combining metadata
- **🗑 Delete** — delete any individual scene and its files from disk
- In **Batch mode**, exclude any groups you want to skip, then run **Merge selected in batch** to process all included groups
- Unsafe groups (large duration differences) can start excluded in batch mode and require explicit confirmation before inclusion
- While a batch is running, the modal shows progress, disables other interactions, and lets you abort the remaining items only
- In **Dry run / preview mode**, merge, delete, and batch actions preview the destination keeper and source scenes instead of executing

---

## How duplicates are detected

Two scenes are considered duplicates when:
- Their pHashes are within the configured Hamming distance, or
- One or both scenes are missing pHash data and the legacy matcher decides they match

The duplicate settings can be tuned in **⚙**:
- **pHash distance** controls how similar pHashes must be (`0` is strictest)
- **Legacy title distance** controls the Levenshtein fallback used only for scenes without pHash

Legacy fallback scenes with no title and no date+studio combination are excluded from duplicate detection.

---

## Codec ranking (best → worst)

`av1` → `hevc / h265` → `vp9` → `h264 / avc` → `mpeg4` → `mpeg2`

---

## Notes

- Loading time scales with library size — large libraries (10,000+ scenes) may take a few seconds
- Keep, merge, delete, and batch actions are permanent and cannot be undone from within the plugin unless you first use **Dry run / preview mode** to inspect them
- Aborting a batch only stops the remaining items; anything already kept, merged, or deleted stays changed
- The floating button persists across page navigation via a MutationObserver
