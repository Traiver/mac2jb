<!-- mac2jb-update: {"build":521,"minimumBuild":0} -->

Traiver's changes on top of cpypwn/mac2jb v0.6.0. The original application,
exploit hosts, USB setup and bundled homebrew remain credited to upstream.

### MistBrew and ice-blue appearance

The launcher is now displayed as **MistBrew**. mac2jb keeps its short app name
and original face mark, with a new ice-blue glass icon. Mac controls use native
Liquid Glass on macOS 26 and newer, with compatible material and Reduce
Transparency fallbacks. The Switch launcher and OunceCake use matching soft blue
accents, dark blue panels and subtle glass highlights. Existing session identifiers
and vendor paths stay compatible with earlier builds.

### OunceCake HTTP/WebDAV integration

The bundled source now uses Cellenseres' OunceCake commit
`6dfd7750752f8b6c18f2c40b34fdadc628cd9a6e`, including native installed-license
contexts and HTTP/WebDAV. Source pins, native-image hash, distribution manifests,
fixtures and release auditing have been updated together. Downloads use the
console address on port **8080**, with read-only WebDAV access. Windows users can
recursively download exports with WinSCP instead of opening individual browser links.

### System titles and original firmware content

OunceCake discovers installed SystemProgram and SystemData titles alongside games.
Available extracted ExeFS/RomFS sections are exposed under
`/system-programs/<title-id>/` and `/system-data/<title-id>/`. The dedicated
**[Firmware] All registered original NCAs** entry exports registered BuiltInSystem
NCA files, including metadata NCAs, under `/firmware/nca/`.

Original NCAs remain encrypted. This is not a complete NAND or boot-partition
backup, does not export keys or user saves, and does not establish that the files
form an installable firmware package. Exports read content without installing or
modifying system titles.

### Raw title exports and preparation recovery

Press **X** on an installed title to export original encrypted NCAs under
`/raw/<title-id>/` without preparing an ELicense or decrypted mounts. Base, update
and DLC content are resolved through NCM; raw game-card export is not supported.
On the normal **A** path, missing or unusable ELicense errors can fall back to raw
NCAs after partial-view handles have been closed and no native worker remains
active. This does not decrypt unreleased or unlicensed content.

Preparation reports progress every 10 seconds and has a cooperative 120-second
deadline. Cancellation waits for the current native operation before cleanup;
the deadline cannot forcibly interrupt a stuck IPC call. Recoverable content
errors return to the catalog after verified cleanup. Transport failures or
uncertain native ownership retain resources and require a console restart.

### Reopening and memory use

Each OunceCake opening uses a temporary catalog directory, removed after
rasterization. Returning to MintBrew and reopening in the same healthy held RPC
session no longer fails because of stale catalog files.

The HTTP server retains twelve client slots while reducing read/cache windows
from 4 MiB to 256 KiB, cutting fixed allocation by **48.75 MiB**. Allocation errors
include requested memory and index size. Retry is offered only after verified
cleanup; invalid nonzero pointers are retained rather than freed. Server shutdown,
thread join, mappings and owned handles must be accounted for before another export.

### Catalog and controller navigation

- SystemProgram/SystemData entries are grouped in **System Files** below the games.
  **A** opens the folder; **Back** or **B** returns to the main list. Firmware
  export remains directly available in the main list.
- A matching ice-blue scrollbar shows the visible position and hides for short lists.
- Holding **Up/Down** repeats navigation after a short delay. **L/R** still pages.
  Folder transitions reset the viewport and restore focus on return without
  rediscovering or mounting content.
- All new interface labels are in English.

### Packaging, documentation and maintenance

- Set the app and source-release identity to **0.6.0-fork-traiver**, build **521**.
  Release links, update downloads and validation use **Traiver/mac2jb**. The updater
  accepts the fork suffix while retaining origin, digest and build validation.
  A separate bundle identifier isolates preferences and Stremio keychain entries.
- Retain cpypwn's README structure and setup instructions, adding export behavior,
  Windows downloads, recovery limits and native ARM build notes.
- Exclude local sessions, captures, logs, caches, Finder metadata and build products
  from source releases. Retain dependency provenance and licenses.
- Expand offline checks for exports, license fallback, cancellation, cleanup,
  reopening, folder navigation and shared GLSL math; include fork checks in CI.

### Remaining limitations

The underlying exploit is unchanged: **2/4 Acquiring FS memory** can still fail.
Exports require a healthy held RPC session. Refresh MintBrew's app list after
replacing assets. Reopening cannot recover lost networking or uncertain cleanup.
