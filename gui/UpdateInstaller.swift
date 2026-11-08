import Foundation
import Darwin
import AppKit

struct UpdateInstallPlan: Codable {
    let directory: URL
    let destination: URL
    let version: String
    let build: Int?
    let minimumBuild: Int?
    let originalSHA256: String
    let updateSHA256: String
    let parentPID: Int32
    init(directory: URL, destination: URL, version: String, build: Int? = nil, minimumBuild: Int? = nil,
         originalSHA256: String, updateSHA256: String, parentPID: Int32) {
        self.directory = directory; self.destination = destination; self.version = version
        self.build = build; self.minimumBuild = minimumBuild
        self.originalSHA256 = originalSHA256; self.updateSHA256 = updateSHA256; self.parentPID = parentPID
    }
    var candidate: URL { directory.appendingPathComponent("unpacked/mac2jb.app", isDirectory: true) }
    var logURL: URL { directory.appendingPathComponent("update.log") }
    var backup: URL { destination.deletingLastPathComponent().appendingPathComponent("mac2jb-backup-" + directory.lastPathComponent + ".app") }
}

enum UpdateInstaller {
    static func waitForExit(_ pid: Int32, timeout: TimeInterval = 45) throws {
        guard pid > 1, pid != getpid() else { throw UpdateFailure("Invalid updater parent process.") }
        let until = Date().addingTimeInterval(timeout)
        while kill(pid, 0) == 0 || errno == EPERM {
            guard Date() < until else { throw UpdateFailure("mac2jb did not close; the installed app was left unchanged.") }
            Thread.sleep(forTimeInterval: 0.1)
        }
    }
    // All file operations run as the current user. No kernel driver, security
    // policy, sessions, or files outside this app/staging/backup are modified.
    static func install(_ plan: UpdateInstallPlan, afterBackup: (() throws -> Void)? = nil) throws {
        let manager = FileManager.default
        let destination = plan.destination
        let parent = destination.deletingLastPathComponent()
        guard destination.pathExtension == "app", !destination.path.contains("/AppTranslocation/"),
              destination.path != plan.candidate.path,
              manager.isWritableFile(atPath: parent.path),
              try destination.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true,
              try UpdatePackage.sha256(destination.appendingPathComponent("Contents/MacOS/mac2jb")) == plan.originalSHA256 else {
            throw UpdateFailure("The installed app changed or its folder is not writable. Move mac2jb to a writable folder and try again.")
        }
        let originalInfo = try PropertyListSerialization.propertyList(
            from: Data(contentsOf: destination.appendingPathComponent("Contents/Info.plist")), format: nil) as? [String: Any]
        guard originalInfo?["CFBundleIdentifier"] as? String == UpdatePackage.bundleID,
              let originalVersion = originalInfo?["CFBundleShortVersionString"] as? String,
              let originalBuild = originalInfo?["CFBundleVersion"] as? String else {
            throw UpdateFailure("The installed mac2jb version or build is invalid.")
        }
        let candidateBuild = try UpdatePackage.validateApp(plan.candidate, version: plan.version,
                                                         build: plan.build, minimumBuild: plan.minimumBuild)
        let candidateVersion = try UpdateVersion(plan.version), installedVersion = try UpdateVersion(originalVersion)
        let installedBuild = try UpdateBuild.parse(originalBuild)
        guard candidateVersion > installedVersion || candidateVersion == installedVersion &&
                candidateBuild > installedBuild else {
            throw UpdateFailure("The update must have a newer version or a higher build of the same version.")
        }
        guard try UpdatePackage.sha256(plan.candidate.appendingPathComponent("Contents/MacOS/mac2jb")) == plan.updateSHA256 else {
            throw UpdateFailure("The staged update changed. Download it again.")
        }
        let incoming = parent.appendingPathComponent(".mac2jb-incoming-" + plan.directory.lastPathComponent + ".app")
        guard !manager.fileExists(atPath: incoming.path), !manager.fileExists(atPath: plan.backup.path) else {
            throw UpdateFailure("An update staging or backup path already exists. The installed app was left unchanged.")
        }
        try manager.copyItem(at: plan.candidate, to: incoming)
        do {
            try UpdatePackage.validateApp(incoming, version: plan.version, build: candidateBuild,
                                          minimumBuild: plan.minimumBuild)
        } catch {
            try? manager.removeItem(at: incoming)
            throw error
        }
        do {
            try manager.moveItem(at: destination, to: plan.backup)
            do {
                try afterBackup?()
                try manager.moveItem(at: incoming, to: destination)
                try UpdatePackage.validateApp(destination, version: plan.version, build: candidateBuild,
                                              minimumBuild: plan.minimumBuild)
            } catch {
                // Preserve a failed candidate in staging, then restore the old
                // bundle. A failed rollback never deletes the saved backup.
                if manager.fileExists(atPath: destination.path) {
                    try manager.moveItem(at: destination, to: plan.directory.appendingPathComponent("failed-update.app"))
                }
                try manager.moveItem(at: plan.backup, to: destination)
                throw error
            }
        } catch {
            try? manager.removeItem(at: incoming)
            throw error
        }
    }

    static func finish(planURL: URL) -> Int32 {
        var plan: UpdateInstallPlan?
        func write(_ message: String) {
            guard let file = plan?.logURL else { return }
            if let handle = try? FileHandle(forWritingTo: file) {
                defer { try? handle.close() }
                _ = try? handle.seekToEnd()
                try? handle.write(contentsOf: Data((message + "\n").utf8))
            }
        }
        do {
            guard FileManager.default.attributesOfItemSafe(at: planURL).owner == getuid() else {
                throw UpdateFailure("The update plan is not owned by this user.")
            }
            let decoded = try JSONDecoder().decode(UpdateInstallPlan.self, from: Data(contentsOf: planURL))
            plan = decoded
            let root = decoded.directory.resolvingSymlinksInPath()
            var info = stat()
            guard lstat(root.path, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFDIR,
                  info.st_mode & 0o077 == 0,
                  planURL.resolvingSymlinksInPath().deletingLastPathComponent() == root,
                  root.lastPathComponent == UUID(uuidString: root.lastPathComponent)?.uuidString,
                  decoded.parentPID > 1, decoded.parentPID != getpid() else {
                throw UpdateFailure("The private update folder or process identity is invalid.")
            }
            let release = AppBuildIdentity.releaseLabel(decoded.version, build: decoded.build)
            write("Waiting for mac2jb to close before updating to \(release).")
            try waitForExit(decoded.parentPID)
            try install(decoded)
            write("Installed \(release). Previous app preserved at: \(decoded.backup.path)")
            do {
                _ = try UpdatePackage.run("/usr/bin/open", ["-n", decoded.destination.path])
                write("Update completed; mac2jb reopened.")
            } catch {
                write("The update was installed but could not reopen automatically: \(error.localizedDescription)")
                showFailure("The update was installed, but mac2jb could not reopen automatically. Open the app yourself.", log: decoded.logURL)
                return 1
            }
            return 0
        } catch {
            write("Update failed: \(error.localizedDescription)")
            showFailure(error.localizedDescription, log: plan?.logURL)
            return 1
        }
    }

    private static func showFailure(_ message: String, log: URL?) {
        let alert = NSAlert()
        alert.messageText = "mac2jb update needs attention"
        alert.informativeText = message + (log.map { "\n\nLog saved at:\n" + $0.path } ?? "")
        if log != nil { alert.addButton(withTitle: "Open log") }
        alert.addButton(withTitle: "Close")
        NSApplication.shared.setActivationPolicy(.accessory)
        NSApplication.shared.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertFirstButtonReturn, let log { NSWorkspace.shared.activateFileViewerSelecting([log]) }
    }
}

private extension FileManager {
    func attributesOfItemSafe(at url: URL) -> (owner: uid_t?, regular: Bool) {
        var value = stat()
        guard lstat(url.path, &value) == 0, value.st_mode & S_IFMT == S_IFREG else { return (nil, false) }
        return (value.st_uid, true)
    }
}
