# DupeFinder

A [Stash](https://github.com/stashapp/stash) plugin that finds duplicate scenes and multi-file scenes in your library, and lets you merge or delete them directly from a floating modal — no page navigation required.

---

## Features

- **Duplicate detection** — finds scenes sharing the same title + date + studio combination
- **Multi-file scene detection** — finds scenes that have more than one file attached
- **Smart "keep" suggestion** — automatically recommends the best scene to keep based on resolution → file size → codec ranking
- **Keep best file cleanup** — in the Multi-file tab, keep the recommended best file and delete the rest without deleting the scene
- **Merge duplicates** — merges metadata from all scenes in a group into the best one in a single click
- **Dry run / preview mode** — preview cleanup, delete, and merge actions before anything destructive happens
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
3. Optional: enable **Dry run / preview mode** in the modal header to preview destructive actions without executing them
4. Two tabs are shown:

### Multi-file tab
Lists every scene that has more than one file attached, sorted by file count. Shows each file's path, resolution, codec, duration, and size. The recommended file is marked **best**.

Available actions:
- **🧹 Keep best** — keeps the recommended best file, safely makes it the scene's primary file if needed, and deletes the other files from disk
- **🗑 Delete scene** — deletes the whole scene and all its files
- In **Dry run / preview mode**, these actions show what would be kept or deleted without making changes

### Duplicates tab
Lists groups of scenes that share the same title + date + studio. For each group:
- The recommended scene to **keep** is highlighted (highest res → smallest size → best codec)
- **⚡ Merge all** — merges all scenes in the group into the recommended keeper, combining metadata
- **🗑 Delete** — delete any individual scene and its files from disk
- In **Dry run / preview mode**, merge and delete actions preview the destination keeper and source scenes instead of executing

---

## How duplicates are detected

Two scenes are considered duplicates if they have the same:
- Title (case-insensitive)
- Date
- Studio

Scenes with no title and no date+studio combination are excluded from duplicate detection.

---

## Codec ranking (best → worst)

`av1` → `hevc / h265` → `vp9` → `h264 / avc` → `mpeg4` → `mpeg2`

---

## Notes

- Loading time scales with library size — large libraries (10,000+ scenes) may take a few seconds
- Merge, delete, and keep-best cleanup actions are permanent and cannot be undone from within the plugin unless you first use **Dry run / preview mode** to inspect them
- The floating button persists across page navigation via a MutationObserver
