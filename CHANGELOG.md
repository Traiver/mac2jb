# Changelog

## mac2jb v0.7.6 — Build 544

- Redesign the Mac app with subtle pointer-responsive mist and fix overlapping console tabs.
- Import edited Account and Device saves from WinSCP in the same OunceCake session. The game folder shows its TitleID, and one confirmation applies the uploads while preserving the rest of the save.
- Reuse the existing export as the backup and verify the result after writing.
- Show build numbers alongside the version and automatically keep the three most recent session folders, protecting active sessions.

## mac2jb v0.7.5 — 2026-11-06

- Add read-only HTTP/WebDAV save exports, including uninstalled games, bulk backups, profile names and labeled BCAT archives.
- Use port 8081 and a short root URL for save downloads.
- Add controller access to MistBrew Refresh, fix startup checks and simplify OunceCake's heading and status text.

## mac2jb v0.7.4 — 2026-11-05

- Hotfix: keep readable OunceCake exports when update manuals cannot mount, and clarify partial-export and license diagnostics.

## mac2jb v0.7.3 — 2026-11-05

- Merge upstream v0.7.3: Cellenseres host, guided setup, USB discovery and bootstrap ETA.
- Add CivSwitch/Control Center, SaveKit, Artemis saves and Elden Ring save conversion.
- Add native HBLauncher/MintNES, SD browsing, browser research, DNSwitch, NSP-Box and NUP tools.
- Improve OunceCake with compacted Base detection, combined Update exports, independent ExeFS/partial exports and clearer diagnostics.

## mac2jb v0.7.0 — 2026-11-05

- Update OunceCake with NSO activation, additional content, DLC updates and patched manuals.
- Split large exports into Base / Update / DLC / Additional Content, with a ten-minute preparation limit.
- Add title-name folders, TitleIDs, full-width labels and Japanese title rendering.
- Improve WebDAV source handling and cleanup while retaining system, firmware and raw NCA exports.

## mac2jb v0.6.0-fork-traiver — 2026-11-01

Based on cpypwn/mac2jb v0.6.0.

- **MistBrew:** soft blue Mac/Switch styling, Liquid Glass with compatibility fallbacks, and a refreshed mac2jb icon.
- **OunceCake:** Cellenseres' implementation, with read-only HTTP/WebDAV downloads on port 8080.
- **System exports:** extracted system-title files, original firmware NCAs, and a grouped **System Files** folder.
- **Raw NCAs:** X exports original installed content without ELicense preparation; missing licenses can fall back to encrypted files after safe cleanup.
- **Reliability:** safer reopening/recovery, a cooperative 120-second preparation timeout, and about 49 MiB less fixed HTTP buffer memory.
- **Navigation and packaging:** scrollbar, held Up/Down scrolling, L/R paging, verified source packages and the Traiver update channel.

NCAs remain encrypted; exports are not full NAND backups. Exploit success rate is unchanged. Lost RPC or uncertain cleanup still requires restart.
