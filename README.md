# mac2jb MistBrew fork

my fork of [cpypwn/mac2jb](https://github.com/cpypwn/mac2jb), an all-in-one
Switch 2 jailbreaking tool for Mac. Based on upstream v0.6.0; this fork adds
OunceCake system-title, elicense titles & original NCA exports.
See [CHANGELOG.md](CHANGELOG.md) for details.

## fork highlights

- OunceCake now uses http instead of ftp
- export extracted system-title files, elicense titles like GameCube NSO or original registered firmware NCAs.
- download original installed title NCAs without preparing an ELicense; missing
  or unusable licenses can fall back to the encrypted export after safe cleanup.
- reopen OunceCake within a healthy held RPC session, with bounded preparation
  and lower HTTP server memory usage. A broken transport still requires restart.

## what you need

- an apple silicon Mac with macOS 14 or newer.
- a Switch 2 on firmware 23.0.1 (earlier versions should also work), with SmileBASIC full version 4.4.9 or demo 4.4.6.
- more than 20 mib free in the game's save. keep the game on internal storage.
- a usb-c data cable. the Switch must use ethernet; the Mac may use wi-fi or
  ethernet. both devices must be on the same local network.
- the Switch's usb keyboard setting set to us english.

[block console updates before testing](https://consolemods.org/wiki/Switch:Blocking_OFW_Updates#90DNS).

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

1. extract the supplied v0.7.0 zip and open `mac2jb.app`.
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

## type and save the new bootstrap

replace your previous bootstrap when updating from an older build or changing hosts.
choose your host in developer options; changing hosts requires
typing and saving that host's matching bootstrap. see [developer options](#developer-options).

1. open SmileBASIC → make a program with an empty editor in slot 0.
2. open first time setup in mac2jb. tick the demo checkbox only for demo 4.4.6.
3. start typing and wait until it finishes. the app defaults to 10 ms per key. after it sends the second enter to confirm load, it waits 1 second for the bootstrap to load before sending run. the other command waits are 0; timing remains adjustable.
4. press x on the Switch controller to return to direct mode.
5. confirm that direct mode has an empty command prompt, then click type save command. mac2jb types the command for your selected edition and presses enter once.
6. confirm saving on the Switch. overwrite the existing file if prompted. after saving finishes, confirm saving in mac2jb.

the skip option is for a complete copy of this build's bootstrap already in slot 0.
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

## jailbreak

1. restart the Switch and open SmileBASIC → make a program → direct mode.
2. connect usb and the Switch's ethernet. connect the Mac to the same network
   by wi-fi or ethernet, then select the Mac's address for that network in mac2jb.
3. tick the demo checkbox if you use the demo; leave it off for the full version.
4. confirm the Switch is ready, then click jailbreak.
5. keep SmileBASIC focused and wait for 4/4 verification. MistBrew then launches automatically.

if verification fails at 2/4 while the Mac is on wi-fi, retry with the Mac on
ethernet. if it fails at 3/4, try a different host and save that host's matching
bootstrap before retrying.

after rpc is verified, the usb cable can be disconnected if the Switch keeps
its separate ethernet connection and the Mac stays on the same network over
wi-fi or ethernet.
keep SmileBASIC and mac2jb open for the session. switching the Switch from
ethernet to wi-fi closes the current rpc connection.

for the demo, select either kurumuz or BermTheSequel in developer options. the
current kurumuz version also fixes the issue on consoles that installed the
update offered when first inserting a microSD Express card. on those consoles,
the update is marked `(B)` beside item 3 under system settings → support/health
& safety.

## homebrew

the standard gui jailbreak launches MistBrew automatically after held rpc is
verified. for host-only with hold rpc or an existing held rpc session, launch
MistBrew from developer options.

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

## finish or retry

close any ftp connection, choose finish session and wait for cleanup.
restart the Switch before another attempt. never send remove twice in the same SmileBASIC session.
if typing stops partway through, inspect and clear the partial input before retrying.
saving the bootstrap does not preserve a live jailbreak connection.

## developer options

- choose pepsipu, kurumuz, BermTheSequel or IZMYSH as the host. type and save the selected
  host's matching bootstrap before running it. pepsipu uses the original
  nine-argument pairing command and does not support held rpc; kurumuz and
  BermTheSequel support held rpc and the demo. IZMYSH uses its NS2I bootstrap,
  port 39395 and a nine-argument pairing command; this GUI profile verifies the
  native session and closes it without exposing held rpc or homebrew controls.
  kurumuz is the default and is recommended when the
  microSD Express update is installed, identified by `(B)` beside item 3 under
  system settings → support/health & safety.
- in additional tools, run host only starts the selected host and waits for
  SmileBASIC commands. enter them manually, use the send commands over USB
  button, or connect live keyboard while the host waits. the USB button uses
  the current host's pairing command and requires the driver. checking hold rpc
  after success shows homebrew directly below it; launch buttons become
  available after 4/4 verification and a held connection.
- rpc already held is also in additional tools. select the original run folder
  for a host still running on this Mac, then connect. mac2jb verifies its live
  connection before enabling homebrew. disconnecting leaves the original host
  running. remote hosts and ssh are not supported.
- live keyboard forwards keys while its capture area is focused. connect it,
  paste text into the text field and click send text to send a string at the
  configured key delay. send up to 16 kib of printable us keyboard characters,
  tabs and line breaks; each line break sends enter. no extra enter is added at the end.
  stop keyboard cancels a transfer and releases keys.
- usb & timing lets you select a controller and adjust typing delays. defaults
  are 10 ms per key, 1 second after the second load enter, and no other command waits.

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
- [Cellenseres](https://github.com/Cellenseres) — [OunceCake](https://github.com/Cellenseres/OunceCake), native installed ELicense contexts and the HTTP/WebDAV implementation used by this fork.

- [pepsipu](https://gitlab.com/pepsipu) — [ns2jb](https://gitlab.com/pepsipu/ns2jb), the original Switch 2 exploit and filesystem research.
- [kurumuz](https://gitlab.com/kurumuz) — [ns2jb](https://gitlab.com/kurumuz/ns2jb), the default host with compatibility updates, microSD Express update support and demo support.
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

see the bundled notices, licenses and upstream documentation for attribution and reuse terms.
