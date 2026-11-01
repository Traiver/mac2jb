<!-- mac2jb-update: {"build":522,"minimumBuild":0} -->

Based on cpypwn/mac2jb v0.6.0.

- **MistBrew:** soft blue Mac/Switch styling, Liquid Glass with compatibility fallbacks, and a refreshed mac2jb icon.
- **OunceCake:** Cellenseres' implementation, with read-only HTTP/WebDAV downloads on port 8080.
- **System exports:** extracted system-title files, original firmware NCAs, and a grouped **System Files** folder.
- **Raw NCAs:** X exports original installed content without ELicense preparation; missing licenses can fall back to encrypted files after safe cleanup.
- **Reliability:** safer reopening/recovery, a cooperative 120-second preparation timeout, and about 49 MiB less fixed HTTP buffer memory.
- **Navigation and packaging:** scrollbar, held Up/Down scrolling, L/R paging, verified source packages and the Traiver update channel.

NCAs remain encrypted; exports are not full NAND backups. Exploit success rate is unchanged. Lost RPC or uncertain cleanup still requires restart.
