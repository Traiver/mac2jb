import Foundation
import Darwin

struct SessionDataCleanup {
    struct Result {
        let sessions: Int
        let entries: Int
    }

    enum CleanupError: LocalizedError {
        case invalidSessionDirectory
        case activeSessionsUnavailable

        var errorDescription: String? {
            switch self {
            case .invalidSessionDirectory: "The session directory could not be verified."
            case .activeSessionsUnavailable: "Open sessions could not be verified."
            }
        }
    }

    private static let retainedEntries: Set<String> = ["savekit-exports", "dumps", "source"]
    private static let sessionLimit = 3

    // Publish new session directories under the same lock used by pruning.
    // The open directory handle keeps the runtime visible to lsof during extraction
    // and whenever there is no session log or helper process open yet.
    static func createSession(at root: URL) throws -> FileHandle {
        try withDirectoryLock(root.deletingLastPathComponent()) {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                                    attributes: [.posixPermissions: 0o700])
            do {
                return try openDirectory(root)
            } catch {
                try? FileManager.default.removeItem(at: root)
                throw error
            }
        }
    }

    @discardableResult
    static func pruneOldSessions(in sessionsDirectory: URL, manager: FileManager = .default) throws -> Int {
        let requested = sessionsDirectory.standardizedFileURL
        guard isPrivateDirectory(requested), let resolved = realpath(requested.path, nil) else {
            throw CleanupError.invalidSessionDirectory
        }
        defer { free(resolved) }
        let sessions = URL(fileURLWithPath: String(cString: resolved), isDirectory: true)
        guard sessions.lastPathComponent == "Sessions",
              sessions.deletingLastPathComponent().lastPathComponent == "mac2jb" else {
            throw CleanupError.invalidSessionDirectory
        }

        return try withDirectoryLock(sessions) {
            let children = try manager.contentsOfDirectory(at: sessions, includingPropertiesForKeys: [.creationDateKey])
            let folders = children.filter { UUID(uuidString: $0.lastPathComponent) != nil && isPrivateDirectory($0) }
            let dated = try folders.map { url -> (url: URL, created: Date) in
                let created = try url.resourceValues(forKeys: [.creationDateKey]).creationDate
                return (url, created ?? .distantPast)
            }
            let candidates = dated.sorted { a, b in
                a.created == b.created ? a.url.path > b.url.path : a.created > b.created
            }.map(\.url)
            guard candidates.count > sessionLimit else { return 0 }
            let active = try openSessions(in: sessions)
            let protectedCount = candidates.filter { active.contains($0.lastPathComponent) }.count
            let inactive = candidates.filter { !active.contains($0.lastPathComponent) }
            let expired = inactive.dropFirst(max(0, sessionLimit - protectedCount))
            for session in expired {
                try manager.removeItem(at: session)
            }
            return expired.count
        }
    }

    private static func openSessions(in sessions: URL) throws -> Set<String> {
        // Older releases have no directory handle. Their open logs, helpers and
        // held RPC workers are also visible here without contacting the console.
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        process.arguments = ["-nP", "-a", "-u", String(getuid()), "-F0n"]
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        try process.run()
        let files = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw CleanupError.activeSessionsUnavailable
        }
        let prefix = "n" + sessions.path + "/"
        return Set(files.split(separator: 0).compactMap { field in
            let name = String(decoding: field, as: UTF8.self)
            guard name.hasPrefix(prefix) else { return nil }
            return name.dropFirst(prefix.count).split(separator: "/").first.map(String.init)
        })
    }

    private static func isPrivateDirectory(_ url: URL) -> Bool {
        var info = stat()
        return lstat(url.path, &info) == 0 && (info.st_mode & S_IFMT) == S_IFDIR &&
            info.st_uid == getuid() && (info.st_mode & 0o077) == 0
    }

    private static func openDirectory(_ directory: URL) throws -> FileHandle {
        let fd = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw POSIXError(.init(rawValue: errno) ?? .EIO) }
        return FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    }

    private static func withDirectoryLock<T>(_ directory: URL, _ body: () throws -> T) throws -> T {
        let handle = try openDirectory(directory)
        defer { try? handle.close() }
        guard flock(handle.fileDescriptor, LOCK_EX) == 0 else { throw POSIXError(.init(rawValue: errno) ?? .EIO) }
        return try body()
    }

    static func clearPastSessions(in sessionsDirectory: URL, keeping currentSession: URL,
                                  manager: FileManager = .default) throws -> Result {
        let sessions = sessionsDirectory.standardizedFileURL.resolvingSymlinksInPath()
        let current = currentSession.standardizedFileURL.resolvingSymlinksInPath()
        guard sessions.lastPathComponent == "Sessions",
              sessions.deletingLastPathComponent().lastPathComponent == "mac2jb",
              current.deletingLastPathComponent() == sessions,
              UUID(uuidString: current.lastPathComponent) != nil,
              currentSession.standardizedFileURL.path == current.path,
              (try? manager.destinationOfSymbolicLink(atPath: current.path)) == nil,
              let sessionValues = try? current.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]),
              sessionValues.isDirectory == true, sessionValues.isSymbolicLink != true else {
            throw CleanupError.invalidSessionDirectory
        }

        let children = try manager.contentsOfDirectory(at: sessions,
            includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey], options: [])
        var sessionsCleared = 0
        var entriesCleared = 0
        for candidate in children {
            guard candidate.standardizedFileURL.path != current.path,
                  UUID(uuidString: candidate.lastPathComponent) != nil,
                  (try? manager.destinationOfSymbolicLink(atPath: candidate.path)) == nil,
                  let values = try? candidate.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]),
                  values.isDirectory == true, values.isSymbolicLink != true,
                  candidate.standardizedFileURL.resolvingSymlinksInPath().deletingLastPathComponent() == sessions else {
                continue
            }
            let entries = try manager.contentsOfDirectory(at: candidate, includingPropertiesForKeys: nil,
                                                          options: [])
            var cleared = false
            for entry in entries where !retainedEntries.contains(entry.lastPathComponent) {
                try manager.removeItem(at: entry)
                entriesCleared += 1
                cleared = true
            }
            if try manager.contentsOfDirectory(at: candidate, includingPropertiesForKeys: nil,
                                               options: []).isEmpty {
                try manager.removeItem(at: candidate)
            }
            if cleared { sessionsCleared += 1 }
        }
        return Result(sessions: sessionsCleared, entries: entriesCleared)
    }
}
