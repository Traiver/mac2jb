# mac2jb MistBrew fork

my fork of [cpypwn/mac2jb](https://github.com/cpypwn/mac2jb), an all-in-one
Switch 2 jailbreaking tool for Mac.

## fork highlights

- OunceCake now uses http instead of ftp
- export extracted firmwares, system titles, games, savegames and more
- supports ELicense titles like NSO GC
- redesigned app and overall enhanced user experience

## what you need

- an apple silicon Mac with macOS 14 or newer and a usb-c data cable.
- for ns2jb: a Switch 2 on firmware 23.0.1 (earlier versions should also work),
  with SmileBASIC full version 4.4.9 or demo 4.4.6. keep the game on internal
  storage with more than 20 mib free in its save. the Switch must use ethernet;
  the Mac may use wi-fi or ethernet. set the Switch's usb keyboard to us english.
- for CivSwitch: a physical Switch 1 edition Civilization VII cartridge at
  version 1.0.0. set the Switch system language to English (US). the Switch and
  Mac must be on the same network so mac2jb can reach the console's IPv4 address.

[block console updates before testing](https://gitlab.com/a/90dns).

## set up the usb driver

the bundled driver is unsigned. Mac startup security and sip must permit unsigned
kernel extensions. if the driver already works with your partial/custom sip
configuration, keep that setup.

### 1. configure macOS recovery

1. shut down the Mac.
2. hold the power button until loading startup options appears.
3. select options → continue. authenticate with an administrator account if asked.
4. open utilities → startup security utility. select your startup disk and click security policy.
5. select reduced security.
6. tick allow user management of kernel extensions from identified developers.
7. confirm the changes, authenticate if asked, then close startup security utility.
8. open utilities → terminal and enter:

   ```sh
   csrutil disable
   ```

9. follow the confirmation and administrator prompts, then choose apple menu → restart.
10. back in macOS, open terminal and enter:

    ```sh
    csrutil status
    ```

    for this route, confirm it reports `System Integrity Protection status: disabled.`
    an existing working partial/custom configuration can report a different status.

### 2. install and load the usb driver

1. extract the supplied v0.7.4 zip and open `mac2jb.app`.
2. if macOS blocks the app, open system settings → privacy & security and choose open anyway if offered, then reopen the app.
3. click install & load driver… and approve the administrator prompt.
4. if prompted, open system settings → privacy & security and allow the driver.
5. accept the restart prompt or choose apple menu → restart.
6. reopen mac2jb and wait for the driver check. continue when the driver is loaded and no driver-install restart is pending.

refresh driver status to check it; each reinstall creates a new restart requirement.
disabling sip reduces macOS protection. mac2jb does not change these settings.
fully re-enabling sip with this unsigned driver has not been verified and may
stop it working after a kernel-collection rebuild. see
[apple's startup-security guidance](https://support.apple.com/en-euro/guide/mac-help/mchl768f7291/27/mac/27)
and [sip documentation](https://developer.apple.com/documentation/security/disabling-and-enabling-system-integrity-protection).

### 3. check usb power direction

a loaded driver does not confirm that the cable is connected correctly.
the Switch should supply power to the Mac; the Mac should not charge the Switch.
if power is flowing the wrong way, unplug the usb-c cable from the Switch,
wait about 1 second, then plug it back into the Switch. check that the Switch
is now supplying power to the Mac.

## type and save the ns2jb bootstrap

a matching saved bootstrap can be reused. pepsipu and IZMYSH share the same
nine-argument program, but pepsipu loads `NS2` and IZMYSH loads `NS2I`.
kurumuz and Cellenseres share the same five-argument program. BermTheSequel
uses a different five-argument copy with an extra check, so keep its own saved
copy. if the matching program is already saved under the selected host's name,
use the normal jailbreak setup. otherwise, choose the host in developer options
and follow these steps.

1. open SmileBASIC → make a program with an empty editor in slot 0.
2. click **Jailbreak with ns2jb**, then **Open first-time setup** in the compact
   card at the top of the popup. tick the demo checkbox on the first-time page
   only when using the SmileBASIC demo with a host that supports it.
3. start typing and wait until it finishes. the app defaults to 10 ms per key. after it sends the second enter to confirm load, it waits 1 second for the bootstrap to load before sending run. the other command waits are 0; timing remains adjustable.
4. press x on the Switch controller to return to direct mode.
5. confirm that direct mode has an empty command prompt, then click type save command. mac2jb types the command for your selected edition and presses enter once.
6. confirm saving on the Switch. overwrite the existing file if prompted. after saving finishes, confirm saving in mac2jb.

**Skip typing** is for a complete matching bootstrap already in slot 0 that
still needs saving. if the matching file is already saved, use **Use saved
bootstrap** on the setup page to skip both typing and saving.
the commands below remain available if you prefer to save manually.

### full version

save with:

```basic
SAVE "NS2"
```

mac2jb loads it with `LOAD "TXT:NS2"` and accepts its confirmation.

### demo version

save every line in slot 0 with this command:

```basic
PRGEDIT 0:C$="":FOR I=0 TO PRGSIZE(0)-1:C$=C$+PRGGET$() :NEXT:SAVEV "TXT:NS2",C$
```

the closed `PRGGET$()` call reads one line and advances to the next, so the loop
is needed to collect the entire bootstrap. see the [SmileBASIC reference](https://sup4.smilebasic.com/en/doku.php?id=reference%3ASource_Code_Operation).

with the demo box ticked, mac2jb loads it using:

```basic
PRGEDIT 0:LOADV "TXT:NS2" OUT C$:PRGSET C$
```

mac2jb types this command and presses enter twice to accept ok, then waits
1 second for the bootstrap to load before sending run.

## jailbreak with ns2jb

1. restart the Switch and open SmileBASIC → make a program → direct mode.
2. connect usb and the Switch's ethernet. connect the Mac to the same network
   by wi-fi or ethernet, then select the Mac's address for that network in mac2jb.
3. click **Jailbreak with ns2jb**. in the setup popup, tick the demo checkbox
   if you use the demo, or leave it off for the full version.
4. confirm the Switch is ready and connected by usb, then click **Start jailbreak**.
5. keep SmileBASIC focused and wait for 4/4 verification. the default Cellenseres
   host holds rpc open and offers MistBrew, SaveKit, and Artemis launcher saves
   or native HBLauncher. launch
   one homebrew at a time while rpc is held.

if verification fails at 2/4 while the Mac is on wi-fi, retry with the Mac on
ethernet. if it fails at 3/4, try a different host and save that host's matching
bootstrap before retrying.

after rpc is verified, the usb cable can be disconnected if the Switch keeps
its separate ethernet connection and the Mac stays on the same network over
wi-fi or ethernet.
keep SmileBASIC and mac2jb open for the session. retained rpc keeps the same
network connection open; switching the Switch from ethernet to wi-fi closes it.
this build does not reconnect that session.

## jailbreak with CivSwitch

[CivSwitch](https://github.com/Gezine/CivSwitch) uses Civilization VII's chat
entry point. it is separate from ns2jb and does not require SmileBASIC or an
ns2jb bootstrap. upstream supports the physical Switch 1 edition cartridge at
version 1.0.0 and reports tests on Switch 2 firmware 20.4.0 and 23.0.1.

1. load the mac2jb usb driver. set the Switch system language to English (US),
   insert the supported cartridge, and keep the Switch and Mac on the same
   network.
2. in Civilization VII, open multiplayer → wireless → create game → host lobby
   → chat. in docked mode, focus the chat input.
3. click **Jailbreak with CivSwitch** in mac2jb. enter the Switch's IPv4 address,
   confirm the cartridge and chat screen are ready, then start the transfer.
4. keep the game and mac2jb open while the Mac sends the chat payload over usb.
   upstream estimates about 15–20 minutes. mac2jb checks the CivSwitch JavaScript
   loader on tcp port 9026 before reporting it ready.

after the loader is verified, click **Show cpypwn demo** to send a JavaScript
display test. it shows `hellow from cpypwn!` with animated mint-colored shapes.
the Mac confirms that the loader executed the script; the display still needs
a console test.

the CivSwitch loader does not expose ns2jb's held rpc session. MistBrew,
SaveKit and the other ns2jb homebrew choices do not run through this path in
this build. use ns2jb to install an Artemis launcher save. the optional
CivSwitch persistent-save installer is not run.

### CivSwitch Control Center

after the CivSwitch loader is verified, open its Control Center from mac2jb.
keep Civilization VII and mac2jb open, with the Switch and Mac on the same
local network while using it.

the save export reads only `save:/saves/Single/XSTRIG.Civ7Save` from
Civilization VII. it does not write the game save. exported copies are kept
under `~/Library/Application Support/mac2jb/CivSwitch/Backups` so they remain
available after the current session. this is a CivSwitch-specific export, not
the general SaveKit save browser.

the input monitor shows controller input received through the CivSwitch loader.
to send your own JavaScript, choose **Payload Mode** on the Switch first, then
choose the `.js` file in mac2jb. after the transfer, press A on the Switch to
start the payload, or B to return to Control Center without starting it.

## Artemis launcher saves

install either the Seedsow Lullaby demo or Nora Princess 2 demo and create a
normal save first. close the selected game, run the ns2jb jailbreak with
Cellenseres or kurumuz, and wait for held rpc. choose **Install seedsowhax** or
**Install norahax** in the Artemis launcher row. the buttons use their
respective bundled mac2jb save packages without downloading them. the packages
combine the pinned [upstream v1 release](https://github.com/alula/switch-artemis-launcher/releases/tag/v1)
with mac2jb's cpypwn showcase and HTTP display updates. mac2jb checks each
bundled archive before installation. **Check for upstream update** separately
reports the latest upstream release; it does not change the bundled packages.

mac2jb backs up and verifies the selected game's save before writing its
launcher files. installing may replace demo progress and settings. if more than
one console account exists, choose the account that owns the demo save. an
existing launcher with different core files is left untouched. the verified
original backup can be opened from the app after installation. the optional
custom Seedsow Lua editor ZIP or folder remains under the developer held-rpc
options.

mac2jb also adds a cpypwn visual demo as `exploitb.lua` when that slot is empty.
if you already have a B-button script, it is preserved. the upstream launcher
labels the slot `exploit2.lua`, but its actual filename is `exploitb.lua`.
loading the modified launcher save starts the cpypwn showcase and HTTP server
automatically. the only white text is `http listening`, shown beneath cpypwn
after the server starts. mac2jb installs this through `inject2.lua` and
`http2.lua`, keeping the original scripts available in recovery mode.
reinstalling can update an earlier mac2jb launcher without replacing an
unknown custom B-button script. the automatic HTTP path still needs a console
test.

after a verified write or skip, mac2jb checks that rpc remains open. you can
choose a homebrew app, install another launcher save, or use SaveKit to export
or write another selected save while rpc is ready. each write gets its own
verified backup. the app does not retry a save operation automatically. finish
the session before closing SmileBASIC, then open the selected demo and load its
Artemis launcher save.

the modified Artemis launcher starts its HTTP server when the save loads. with the Mac
and Switch on the same network, open **Console & Developer Options → Artemis
HTTP** in mac2jb, enter the Switch's IPv4 address, and check the connection.
the developer controls can send Lua to `/eval`, upload a file to a `save:/`
path, or delete a selected save file. they use the game launcher on port 8080
and do not require a held SmileBASIC rpc session. uploads are limited to
28,672 bytes by the upstream server.

the [Artemis launcher](https://github.com/alula/switch-artemis-launcher) is a
persistent on-device Lua entry point; it does not provide SmileBASIC's held rpc
receiver. mac2jb installs its save through
[ns2-savekit](https://github.com/dougchansan/ns2-savekit) and the selected
ns2jb host. upstream documents JKSV plus official save transfer as its tested
setup route; this mac2jb rpc installation path still needs console testing.

## save data and research tools

after a regular jailbreak with Cellenseres or kurumuz, **Start SaveKit** opens
the full set of save actions in the held session: account, title and archive
lists; inspection and verified backups; and the experimental write, restore,
delete and verify controls. the bundled research source catalog is available
there too. the same controls are available under **Console & Developer Options →
Additional tools** after a host-only run with **Hold RPC after success** checked
and 4/4 verification complete.
list installed titles from internal storage, SD and game card. **List save archives**
reads the console's save index, including saves for games that are no longer
installed; select an archive there to fill its title, account and archive fields.
the installed-title picker shows names when available. enter a title ID manually
if needed. read-only backups work for any selected title.
each write, delete or restore backs up an existing save and verifies it before
changing files. repeated save opens
can interrupt the host; if rpc is lost, restart the Switch and start a fresh
session.

archive filters and an optional all-archive scan are available for titles with more than one save. the game
being inspected must be fully closed.

to collect an untouched save, select its title and account, then click
**Back up save** and **Open verified save export**. for archives outside the
normal account save, use **Scan all matching archives** before backing up.
retain the complete export folder, including `manifest.json`. the Nora
Princess 2 trial title ID is `010012900D38A000` if it is absent from the
installed list. this read-only step does not install a Lua payload.

the SaveKit panel can compare a live save with an export, write a folder of flat
save files, or delete one root file for any selected title with an accessible
save archive. it can also restore a verified mac2jb export to the selected
title's Account or Device archive at rank 0 and index 0. restore replaces files
in the export and keeps other live files. every write, delete or restore
requires confirmation and a verified backup when a current save exists.
large files are verified in chunks after writing. the separate **SaveKit
research sources** catalog keeps the previous research utilities and adds the current
upstream save and Artemis tools. it provides source paths and syntax checks;
utilities with hardware or local path requirements are run manually after review.

### elden ring save conversion

**Elden Ring save conversion** is available in developer options on the Mac.
choose a PC `.sl2` save and a complete Elden Ring Switch 2 SaveKit backup folder,
including its `manifest.json`. select the PC character and the Switch character
slot to replace, then click **Convert save**. mac2jb creates a new folder with
the converted character and profile files; it leaves both source saves intact.

to install the converted character, close Elden Ring on the Switch and open
SaveKit in a verified held rpc session. select Elden Ring and its account,
choose the converted folder with **Choose local save folder…**, then click
**Back up and write save**. SaveKit backs up the current Switch save and
verifies the written files. keep the original complete SaveKit export for
recovery.

the experimental **SD card files** tool uses a verified held FS rpc session
and [Super File Bros.](https://github.com/byizmysh/super-file-bros) to expose
only the Switch's `/sd` filesystem. enter the Switch's IPv4 address, open the
read-only browser, and use its local panel or FTP address to browse and download
files. stop the browser before using another rpc tool. this does not decode
game content or send ROMs to a MistBrew app; OunceCake remains the option for
decoded files from a selected game. SD browsing still needs console testing.

for the demo, select Cellenseres, kurumuz or BermTheSequel in developer options. the
current kurumuz version also fixes the issue on consoles that installed the
update offered when first inserting a microSD Express card. on those consoles,
the update is marked `(B)` beside item 3 under system settings → support/health
& safety.

## homebrew

after the standard gui jailbreak verifies held rpc, choose MistBrew from the
post-jailbreak panel. for host-only with hold rpc or an existing held rpc
session, launch MistBrew from developer options.

to try a different standalone launcher while rpc stays held, click **Stop
current homebrew** and wait until mac2jb confirms that it stopped cleanly.
then choose another homebrew from the same panel. this switch is experimental;
if cleanup or rpc verification fails, restart the Switch and begin a new
session. inside MistBrew, use B or Minus to return from an app to its list.

MistBrew combines Stremio, DOOM, Froggy Road, OunceCake, ftpd-sb, a CPU-to-GPU
probe, Hello World and a CHIP-8 test emulator. add or remove compatible gpu apps
while it is open, then refresh the list on the Switch. hold B or Minus to return
from a running app and choose another in the same held rpc session.

DOOM is a GPU POC based on PureDOOM, bundled with DOOM shareware v1.9 (Episode 1).

ftpd-sb shares SmileBASIC's `/save` and `/tmp` files with read/write access
and `/rom` with read-only access. press A in ftpd-sb to start its server, then
connect to the console IP shown on screen using anonymous, passive FTP on port
5000. ftpd-sb does not expose other games' files; use OunceCake for a selected
game's read-only HTTP/WebDAV share.

In MistBrew's OunceCake app, games remain in the main list. All `[SystemProgram]`
and `[SystemData]` entries are grouped under `[Folder] System Files`. Press A to
open this folder; select `[..] Back` or press B to return to the main list.
The firmware export remains directly accessible as `[Firmware] All registered
original NCAs`. Select a title or firmware entry, then press A. Press X
on a title to serve its original encrypted NCAs directly under `/raw/<title-id>/`,
without preparing an ELicense or mounting decrypted views. Base content and
installed updates/DLC are resolved through NCM; raw game-card export is not
supported. A missing or unusable ELicense on the A path falls back to raw only
after partial-view handles are closed and no native worker remains active.
Content with no RightsId does not require ELicense enumeration. L/R pages
through the list. Hold Up/Down to repeat after a short initial delay; release
to stop. The ice-blue scrollbar at the right shows the current visible position.
It is hidden when all entries fit on one page. Connect to the displayed HTTP/WebDAV address on port 8080
with a browser or WinSCP (WebDAV, no TLS or credentials).

Title rows use the full list width; long names can scale down to fit while retaining their TitleID. The firmware entry omits its internal sentinel ID.

Japanese title glyphs use the Japanese font installed with macOS (not redistributed). Selected titles are rendered as Unicode image tiles on the Switch, including during preparation and transfer; operational messages and URLs retain their ASCII rendering.

HTTP/WebDAV shares place all export paths below `<Title Name> [<TitleID>]`. Unsafe filename characters are replaced with spaces. Category exports keep the original game name, and title rows display their TitleID.

Large game exports (file index above 8 MiB, or a safely recovered server allocation failure) open a category menu: **Base / Update / DLC / Additional Content**. The latter includes metadata, logos, control data, manuals and legal information across installed packages. Program RomFS/ExeFS and DLC Data remain in their respective categories. Empty categories return to the menu. Small titles keep the direct export; X still exports original NCAs. Known large titles are remembered for the held MistBrew run. The first detection requires preparing the catalog once. Category splitting reduces allocation size but cannot guarantee that an individually huge category fits available console memory.

OunceCake also incorporates MissHexa's November 4 update: NSO title activation,
additional program indices, control/logo/manual/legal content, DLC updates and
patched-manual fixes. NSO titles must have been opened recently on the console.
The primary program keeps `/base/romfs` and `/base/exefs`; additional program
indices appear under `program/<index>`. Raw exports include secondary content
and DLC updates. Only available filesystem sections are exposed.

System titles expose their available extracted `exefs` and `romfs` sections
under `/system-programs/<title-id>/` or `/system-data/<title-id>/`. A section
absent from the selected NCA is omitted. The firmware entry exposes registered
BuiltInSystem NCA files, including registered metadata NCAs, under
`/firmware/nca/`; WinSCP can download the entire directory. These original NCAs
remain encrypted. This is a system-content export, not a complete NAND or boot
partition backup, and does not export keys or user saves. It does not certify
that the downloaded set is installable by another program. The exporter reads
console files; it does not modify or install system titles.

OunceCake recognizes the NCM **Compacted** flag before a whole-title export.
A compacted Base can require its installed Update for a usable view. Choose
**Update** for the composed Base + Update filesystem, identified as
**COMBINED HTTP**. The explicit **Base** choice can still attempt individually
readable sections; failures remain distinct from console-reported absence.
**X** continues to export the original installed NCAs.

When a base RomFS returns an all-zero header, OunceCake offers the export-part
menu so Update can be selected independently. An explicit **Base** export can
continue to ExeFS after a RomFS validation failure once the failed storage has
closed safely. Such a share is marked **PARTIAL**; its section diagnostics are
retained in the session report. A console-reported absent section is recorded
separately. An invalid header does not prove that a section is intentionally
absent. If no Base section is readable, no empty share is started.

Press B after downloads finish to stop the server and return to the list;
hold B or Minus to return to MistBrew. Server stop, thread join and owned-handle
cleanup must complete before another export starts. Preparation has a cooperative
10-minute deadline and progress messages every 10 seconds. After the deadline,
the current console operation is awaited before cancelling and closing handles.
This is not a hard kill of a native IPC operation. A transport failure or
unproven native cleanup still retains resources and requires a console restart.
Each OunceCake opening uses a private temporary catalog directory, which is
removed after rasterization, so returning to MistBrew and reopening is supported.
The HTTP server keeps twelve client slots with 256 KiB read/cache buffers; its
fixed buffer allocation is about 49 MiB smaller than the previous 4 MiB windows.
Allocation failures report requested memory and index size. A retry is offered
only after server cleanup was verified; an invalid nonzero address is retained
for restart rather than passed to the native free function.

the earlier GPU MintNES and MintFTP prototypes remain in the source tree.
neither is included in the MistBrew app list. a separate native MintNES test
app is included with HBLauncher.
File Exchange is also available in MistBrew as an experimental app. it uses
the IZ2S file browser and FTP service within the current MistBrew session,
then returns to the app list. its console display and file transfers still
need a Switch test.
IZlauncher is available as an experimental choice only under **Hold RPC after
success** in developer options. its current Mac adaptations include File Exchange,
BlitBun and VacooTube; video and capture pipelines still need console testing.
the latest upstream IZ2S Platform and IZDOOM releases match the pinned source.
HBLauncher is a separate native ABI 3 choice after a fresh Cellenseres or
kurumuz held rpc session. this release includes its Hello CPU and GPU Triangle sample apps,
plus MintNES. MintNES runs its NES CPU and graphics emulation on the Switch CPU
and displays the result through HBLauncher's renderer. it includes the
open-source Diamond Chase ROM. place supported `.nes` files in
`/sd/roms/nes` on the Switch SD card, or enter another folder under `/sd/` in
mac2jb's SD ROM folder field. mac2jb reads those files through held rpc before
HBLauncher starts and adds them to MintNES's ROM list without changing the SD
card. for Mac ROMs, click **open MintNES ROM folder** and add `.nes` files there.
the bundled ROM remains available if the SD folder is absent. press X in the
MintNES ROM list to refresh Mac ROMs added or removed during this session.
MintNES currently supports mapper 0 ROMs with 16 or 32 KB PRG and CHR ROM or
RAM. MintNES presses NES Start once after a short loading delay unless you
press Plus first. Plus sends NES Start, X sends Select, A/B are NES A/B, and
the D-pad or left stick moves. press Minus once during a game to return to the ROM
list; hold Minus to return to HBLauncher. the native audio path is attempted
and falls back to silent play if the console rejects it.
choose HBLauncher before starting MistBrew or another app, then use its app
library on the Switch. you can open the native apps folder in mac2jb and add
compatible built ABI 3 packages before launching it. the current MistBrew GPU
session keeps its own display resources alive, so native apps cannot yet be
opened from MistBrew's menu in the same session.

the [Animal Crossing](https://github.com/ravensclawx/AnimalCrossing-HBLauncher)
and [Twilight Princess](https://github.com/ravensclawx/TwilightPrincess-HBLauncher)
ports need their own built packages, the HBLauncher Linux personality runtime,
user-supplied GameCube game data and a local file server. neither game is
bundled or verified in this Mac release.

## finish or retry

close any FTP or WebDAV connection, choose finish session and wait for cleanup.
restart the Switch before another attempt. never send remove twice in the same SmileBASIC session.
if typing stops partway through, inspect and clear the partial input before retrying.
saving the bootstrap does not preserve a live jailbreak connection.

## developer options

- choose pepsipu, kurumuz, Cellenseres, BermTheSequel or IZMYSH as the host. use
  its matching saved bootstrap, or type and save one if needed. pepsipu uses the original
  nine-argument pairing command and does not support held rpc; kurumuz,
  Cellenseres and BermTheSequel support held rpc and the demo. IZMYSH uses its NS2I bootstrap,
  port 39395 and a nine-argument pairing command; this GUI profile verifies the
  native session and closes it without exposing held rpc or homebrew controls.
  Cellenseres is the default and supports SaveKit, Artemis save installation
  and native HBLauncher alongside kurumuz. kurumuz supports the microSD Express
  update identified by `(B)` beside item 3 under system settings →
  support/health & safety.
- in additional tools, run host only starts the selected host and waits for
  SmileBASIC commands. enter them manually, use the send commands over USB
  button, or connect live keyboard while the host waits. the USB button uses
  the current host's pairing command and requires the driver. checking hold rpc
  after success shows homebrew directly below it; launch buttons become
  available after 4/4 verification and a held connection.
- rpc already held is also in additional tools. click **Find open RPC** to search
  for verified local sessions and connect when one is found. if several are
  open, choose one; you can also select a `switch2-*` run folder manually.
  mac2jb verifies the live connection before enabling homebrew. disconnecting
  leaves the original host running. remote hosts and ssh are not supported.
- live keyboard forwards keys while its capture area is focused. connect it,
  paste text into the text field and click send text to send a string at the
  configured key delay. send up to 16 kib of printable us keyboard characters,
  tabs and line breaks; each line break sends enter. no extra enter is added at the end.
  stop keyboard cancels a transfer and releases keys.
- usb & timing lets you select a controller and adjust typing delays. defaults
  are 10 ms per key, 1 second after the second load enter, and no other command waits.
- switch browser research offers mac2jb's seven local diagnostics for runtime,
  media, network, boundaries, fonts and WebKit behavior, plus the included
  [Jmesmykil research scripts](https://github.com/Jmesmykil/switch2-captive-portal-research).
  choose either included source or a local folder in developer options, then
  start its page. mac2jb copies included scripts to Application Support and
  stores reports there. use the page URL with DNSwitch and run the Switch
  connection test. if the portal stays open, tap cpypwn to load the probe.
  portal entry is experimental and may loop or fail to open.
  stop DNSwitch and restore the Switch's DNS settings when finished. this panel
  is separate from jailbreak and rpc; desktop checks do not
  establish that a probe works on Switch hardware.
- NSP-Box packages an already-extracted ExeFS/RomFS game or DLC snapshot into
  an NSP on this Mac. its Windows emulator patch is not included. the tool is
  under developer options and never reads a retail encrypted game or console
  key.
- NUP can pack an extracted game dump into a compressed `.nup` file, inspect
  and verify a NUP, list its files, or extract it. click **Get pinned NUP source**
  in developer options first; mac2jb fetches that revision from upstream and
  checks its hash before running it locally. the bundled zstandard dependency
  provides compression. neither tool needs an rpc session.

## build from source

On an Apple Silicon Mac, use Xcode 26 or newer (or Command Line Tools with
the macOS 26 SDK or newer), CMake and the official
node v24.22.1 macOS arm64 or universal executable, then run:

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
uname -m                         # must report arm64
python3 -c 'import platform; print(platform.machine())'  # arm64
cmake --version
python3 scripts/prepare-homebrew-runtime.py
bash scripts/check.sh
make gui
build/mac2jb.app/Contents/MacOS/mac2jb --self-test
```

use native ARM tools on Apple Silicon. Intel Homebrew tools under `/usr/local`
can invoke Rosetta even from an ARM terminal; prefer ARM Homebrew in
`/opt/homebrew` for Python and CMake. If `xcrun` reports an incompatible
architecture, verify those tools before rebuilding. The bundled Node executable
is checked and thinned to ARM64 during packaging.

this uses the existing build workflow and produces `build/mac2jb.app`, including
its offline runtime and source archive. if node is elsewhere, set `NODE_BINARY`
to its absolute executable path. the build prepares pinned homebrew dependencies
when needed. the self-test checks the packaged runtime without sending console
commands. the full macOS fixture and node check list is in
[the build workflow](.github/workflows/build.yml).

## help and source

use the console and session logs to investigate failures. for support, join the [StonedCold Discord server](https://discord.gg/Sy6QUkR5t).

## credits

- [cpypwn](https://github.com/cpypwn) — [mac2jb](https://github.com/cpypwn/mac2jb), the original macOS application and build workflow.
- [Cellenseres](https://github.com/Cellenseres) — [OunceCake](https://github.com/Cellenseres/OunceCake), the default ns2jb host, native installed ELicense contexts and the HTTP/WebDAV implementation used by this fork.

- [pepsipu](https://gitlab.com/pepsipu) — [ns2jb](https://gitlab.com/pepsipu/ns2jb), the original Switch 2 exploit and filesystem research.
- [kurumuz](https://gitlab.com/kurumuz) — [ns2jb](https://gitlab.com/kurumuz/ns2jb), a host with compatibility updates, microSD Express update support and demo support.
- [BermTheSequel](https://gitlab.com/BermTheSequel) — [ns2jb2](https://gitlab.com/BermTheSequel/ns2jb2), demo support.
- [shinyquagsire](https://github.com/shinyquagsire23) — [libusbd](https://github.com/shinyquagsire23/libusbd) and [macos_usb_gadget_poc](https://github.com/shinyquagsire23/macos_usb_gadget_poc), usb device emulation and macOS gadget-driver work.
- [misshexa66](https://github.com/misshexa66) — [OunceCake](https://github.com/misshexa66/OunceCake), game-content export.
- [ravensclawx](https://github.com/ravensclawx) — [HBLauncher](https://github.com/ravensclawx/HBLauncher), the SmileBASIC gpu app launcher and sdk, and [ftpd-sb](https://github.com/ravensclawx/ftpd-sb), bundled with MistBrew and the base for the MintFTP prototype.
- [niftynova](https://github.com/NiftyNova) — [gpubrewlauncher](https://github.com/NiftyNova/GPUBrewLauncher), the updated gpu app launcher.
- [byizmysh](https://github.com/byizmysh) — [IZ2S Platform](https://github.com/byizmysh/IZ2S-Platform), [BlitBun](https://github.com/byizmysh/BlitBun), [VacooTube](https://github.com/byizmysh/VacooTube) and [IZDOOM](https://github.com/byizmysh/IZDOOM). mac2jb includes DOOM in MistBrew and retains the IZlauncher and Mac module adaptations in source.
- [Stremio](https://github.com/Stremio/stremio-web) — the official app icon used in MistBrew.
- [id Software](https://github.com/id-Software) — the original [Doom engine source](https://github.com/id-Software/DOOM) used by doomgeneric.
- [ozkl](https://github.com/ozkl) — [doomgeneric](https://github.com/ozkl/doomgeneric), the Doom-compatible engine in the BlitBun Mac adaptation source.
- [Freedoom contributors](https://freedoom.github.io/) — [Freedoom: Phase 1](https://github.com/freedoom/freedoom), free game data retained with the BlitBun Mac adaptation source.
- [Khronos Group](https://github.com/KhronosGroup) — [glslang](https://github.com/KhronosGroup/glslang) and [SPIRV-Tools](https://github.com/KhronosGroup/SPIRV-Tools), shader compilation and validation.
- [Electron](https://www.electronjs.org/) — the Mac runtime referenced by the VacooTube adaptation source.

- [Gezine](https://github.com/Gezine) — [CivSwitch](https://github.com/Gezine/CivSwitch), the Civilization VII chat entry point, payload and USB macro adapted for the Mac flow.
- [duszmox](https://github.com/duszmox) — [PR #11](https://github.com/cpypwn/mac2jb/pull/11), automatic USB controller discovery through the IORegistry.
- [dougchansan](https://github.com/dougchansan) — [ns2-savekit](https://github.com/dougchansan/ns2-savekit), save discovery, verified backups and save tools.
- [alula](https://github.com/alula) — [switch-artemis-launcher](https://github.com/alula/switch-artemis-launcher), the Seedsow and Nora save launchers and HTTP interface.
- [smarkyie](https://github.com/smarkyie) — [NSP-Box](https://github.com/smarkyie/NSP-Box), the extracted-snapshot packager adapted for Mac.
- [a55uka](https://github.com/a55uka) — [nup](https://github.com/a55uka/nup), the NUP format and reference tool fetched on request.
- [Jmesmykil](https://github.com/Jmesmykil) — [Switch 2 captive portal research scripts](https://github.com/Jmesmykil/switch2-captive-portal-research), included with permission for browser diagnostics.
- [Northernside](https://github.com/Northernside) — [PR #9](https://github.com/cpypwn/mac2jb/pull/9), measured keystroke timing for the bootstrap ETA.

see the bundled notices, licenses and upstream documentation for attribution and reuse terms.
