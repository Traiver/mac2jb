import Foundation

@main enum TestSessionDataCleanup {
    static func main() throws {
        let manager = FileManager.default
        let parent = manager.temporaryDirectory.appendingPathComponent("mac2jb-cleanup-\(UUID().uuidString)")
        let sessions = parent.appendingPathComponent("mac2jb/Sessions")
        defer { try? manager.removeItem(at: parent) }
        try manager.createDirectory(at: sessions, withIntermediateDirectories: true)

        func folder(_ name: String) throws -> URL {
            let url = sessions.appendingPathComponent(name, isDirectory: true)
            try manager.createDirectory(at: url, withIntermediateDirectories: false)
            return url
        }

        func write(_ name: String, in folder: URL) throws {
            try Data(name.utf8).write(to: folder.appendingPathComponent(name))
        }

        let current = try folder(UUID().uuidString)
        try write("active.log", in: current)
        let pastWithExports = try folder(UUID().uuidString)
        try write("gui-session.log", in: pastWithExports)
        for name in ["savekit-exports", "dumps", "source"] {
            let retained = pastWithExports.appendingPathComponent(name, isDirectory: true)
            try manager.createDirectory(at: retained, withIntermediateDirectories: false)
            try write("keep", in: retained)
        }
        let pastRuntimeOnly = try folder(UUID().uuidString)
        try write("node", in: pastRuntimeOnly)
        let unrelated = try folder("not-a-session")
        try write("keep", in: unrelated)
        let external = parent.appendingPathComponent("external", isDirectory: true)
        try manager.createDirectory(at: external, withIntermediateDirectories: false)
        try write("keep", in: external)
        try manager.createSymbolicLink(at: pastWithExports.appendingPathComponent("external-link"),
                                       withDestinationURL: external)
        try manager.createSymbolicLink(at: sessions.appendingPathComponent(UUID().uuidString),
                                       withDestinationURL: external)

        let result = try SessionDataCleanup.clearPastSessions(in: sessions, keeping: current)
        precondition(result.sessions == 2 && result.entries == 3)
        precondition(manager.fileExists(atPath: current.appendingPathComponent("active.log").path))
        precondition(!manager.fileExists(atPath: pastWithExports.appendingPathComponent("gui-session.log").path))
        precondition(!manager.fileExists(atPath: pastRuntimeOnly.path))
        for name in ["savekit-exports", "dumps", "source"] {
            precondition(manager.fileExists(atPath: pastWithExports.appendingPathComponent(name + "/keep").path))
        }
        precondition(manager.fileExists(atPath: unrelated.appendingPathComponent("keep").path))
        precondition(manager.fileExists(atPath: external.appendingPathComponent("keep").path))

        do {
            _ = try SessionDataCleanup.clearPastSessions(in: sessions,
                keeping: sessions.appendingPathComponent(UUID().uuidString))
            fatalError("missing current session should be rejected")
        } catch SessionDataCleanup.CleanupError.invalidSessionDirectory {}

        try testRetention(in: parent)
        print("session data cleanup: passed")
    }

    static func testRetention(in parent: URL) throws {
        let manager = FileManager.default
        let app = parent.appendingPathComponent("retention/mac2jb", isDirectory: true)
        let sessions = app.appendingPathComponent("Sessions", isDirectory: true).resolvingSymlinksInPath()
        try manager.createDirectory(at: sessions, withIntermediateDirectories: true,
                                    attributes: [.posixPermissions: 0o700])
        let ordered = try (0..<5).map { index in
            let folder = sessions.appendingPathComponent(UUID().uuidString, isDirectory: true)
            let lease = try SessionDataCleanup.createSession(at: folder)
            try lease.close()
            try manager.setAttributes([.creationDate: Date(timeIntervalSince1970: 1_700_000_000 + Double(index))],
                                      ofItemAtPath: folder.path)
            return folder
        }
        let unrelated = sessions.appendingPathComponent("keep-me")
        try manager.createDirectory(at: unrelated, withIntermediateDirectories: false)
        let link = sessions.appendingPathComponent(UUID().uuidString)
        try manager.createSymbolicLink(at: link, withDestinationURL: unrelated)
        let backup = ordered[1].appendingPathComponent("runs/mintbrew-test/save-backups", isDirectory: true)
        try manager.createDirectory(at: backup, withIntermediateDirectories: true)
        try Data("backup".utf8).write(to: backup.appendingPathComponent("save"))

        let activeLog = ordered[0].appendingPathComponent("gui-session.log")
        try Data().write(to: activeLog)
        let logHandle = try FileHandle(forWritingTo: activeLog)
        defer { try? logHandle.close() }
        let removed = try SessionDataCleanup.pruneOldSessions(in: sessions)
        precondition(removed == 2)
        for (index, folder) in ordered.enumerated() {
            precondition(manager.fileExists(atPath: folder.path) == [0, 3, 4].contains(index))
        }
        let appEntries = try manager.contentsOfDirectory(atPath: app.path)
        precondition(appEntries == ["Sessions"])
        precondition(manager.fileExists(atPath: unrelated.path) && manager.fileExists(atPath: link.path))

        let new = sessions.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let lease = try SessionDataCleanup.createSession(at: new)
        defer { try? lease.close() }
        try manager.setAttributes([.creationDate: Date(timeIntervalSince1970: 1_600_000_000)], ofItemAtPath: new.path)
        let pruned = try SessionDataCleanup.pruneOldSessions(in: sessions)
        precondition(pruned == 1)
        precondition(manager.fileExists(atPath: new.path))
        precondition(!manager.fileExists(atPath: ordered[3].path))
        let repeatPrune = try SessionDataCleanup.pruneOldSessions(in: sessions)
        precondition(repeatPrune == 0)
    }
}
