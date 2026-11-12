import AppKit
import Combine
import Foundation
import SwiftUI

private typealias OunceCakeImportState<Value> = SwiftUI.State<Value>

struct OunceCakeImportRequest: Decodable {
    struct Archive: Decodable {
        let id: String
        let space: Int
        let type: Int
        let rank: Int
        let index: Int
        let uid: String
        let titleId: String
        let userName: String?
    }
    let format: String
    let version: Int
    let nonce: String
    let titleName: String
    let sourceSession: String
    let ownerPid: Int32
    let expires: Double
    let transport: String?
    let archive: Archive
}

struct OunceCakeImportContext: Identifiable {
    let root: URL
    let folder: URL
    let request: OunceCakeImportRequest
    var id: String { request.nonce }

    static func load(root: URL, folder: URL, nonce: String) throws -> Self {
        let realRoot = root.resolvingSymlinksInPath().standardizedFileURL
        let realFolder = folder.resolvingSymlinksInPath().standardizedFileURL
        guard realFolder.path.hasPrefix(realRoot.appendingPathComponent("runs").path + "/mintbrew-"),
              realFolder.deletingLastPathComponent().lastPathComponent == "save-imports",
              realFolder.lastPathComponent == "request-" + nonce,
              nonce.range(of: "^[a-f0-9]{48}$", options: .regularExpression) != nil else { throw ImportError.invalid }
        let data = try Data(contentsOf: realFolder.appendingPathComponent("request.json"))
        guard data.count <= 65536 else { throw ImportError.invalid }
        let request = try JSONDecoder().decode(OunceCakeImportRequest.self, from: data)
        guard request.format == "mac2jb.save-import-request", request.version == 1,
              request.nonce == nonce, request.expires > Date().timeIntervalSince1970 * 1000,
              request.archive.titleId.range(of: "^[a-f0-9]{16}$", options: .regularExpression) != nil,
              request.archive.uid.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
              [1, 3].contains(request.archive.type), [1, 4].contains(request.archive.space),
              request.archive.rank == 0, request.archive.index == 0 else { throw ImportError.invalid }
        return Self(root: realRoot, folder: realFolder, request: request)
    }
    enum ImportError: LocalizedError {
        case invalid
        var errorDescription: String? { "This save import request is invalid or expired. Select the archive again in OunceCake." }
    }
}

@MainActor final class OunceCakeImportModel: ObservableObject {
    struct Plan: Decodable { let digest: String; let files: Int; let bytes: Int; let changed: Int }
    private struct Result: Decodable {
        let phase: String
        let message: String?
        let backupPath: String?
        let verified: Bool?
        let writeMayHaveOccurred: Bool?
        let cleanupBlocked: Bool?
    }
    let context: OunceCakeImportContext
    @Published private(set) var plan: Plan?
    @Published private(set) var source: URL?
    @Published private(set) var busy = false
    @Published private(set) var submitted = false
    @Published private(set) var terminal = false
    @Published private(set) var status = "Choose the exported save folder containing manifest.json and files/."
    @Published private(set) var backupURL: URL?
    @Published private(set) var success = false
    @Published private(set) var uncertain = false
    private var timer: Timer?
    private var lastPhase = ""
    private let onTerminal: ((String) -> Void)?

    init(context: OunceCakeImportContext, onTerminal: ((String) -> Void)? = nil) {
        self.context = context
        self.onTerminal = onTerminal
        if context.request.transport == "webdav" {
            submitted = true
            status = "Checking the uploaded save files…"
        }
    }
    func start() {
        refresh()
        guard !terminal, timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }
    func stop() {
        guard terminal || !SaveImportQuitGuard.contains(self) else { return }
        timer?.invalidate(); timer = nil
    }
    func choose() {
        guard !busy, !submitted, !terminal else { return }
        let picker = NSOpenPanel()
        picker.title = "Choose an OunceCake save backup"
        picker.canChooseDirectories = true; picker.canChooseFiles = false; picker.allowsMultipleSelection = false
        picker.begin { [weak self] response in
            guard response == .OK, let url = picker.url else { return }
            Task { @MainActor in await self?.prepare(url) }
        }
    }
    private func prepare(_ url: URL) async {
        guard !submitted, !terminal else { return }
        busy = true; plan = nil; source = nil; status = "Checking and staging the selected save files…"
        defer { busy = false }
        do {
            let data = try await helper("stage", argument: url.path)
            let next = try JSONDecoder().decode(Plan.self, from: data)
            guard !terminal else { return }
            plan = next; source = url
            status = "Ready to import. Console files absent from this folder will be kept."
        } catch { if !terminal { status = error.localizedDescription } }
    }
    func confirm() async {
        guard let plan, !busy, !submitted, !terminal else { return }
        busy = true; status = "Confirming import…"
        SaveImportQuitGuard.begin(self)
        defer { busy = false }
        do {
            _ = try await helper("confirm", argument: plan.digest)
            submitted = true; status = "Waiting for OunceCake to back up the current save…"
        } catch {
            // A helper can fail after writing its confirmation. Keep observing
            // that one-shot request instead of assuming no write was queued.
            let data = try? Data(contentsOf: context.folder.appendingPathComponent("command.json"))
            let command = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] }
            if command?["action"] == "confirm", command?["nonce"] == context.id,
               command?["digest"] == plan.digest {
                submitted = true; status = "Import was confirmed. Waiting for OunceCake's result…"
            } else { SaveImportQuitGuard.finish(self); status = error.localizedDescription }
            refresh()
        }
    }
    func cancel() async {
        guard !submitted, !busy, !terminal else { return }
        busy = true
        do { _ = try await helper("cancel"); status = "Cancelling import…" }
        catch { status = error.localizedDescription; busy = false }
        refresh()
    }
    private func helper(_ action: String, argument: String? = nil) async throws -> Data {
        let root = context.root, folder = context.folder
        return try await Task.detached(priority: .userInitiated) {
            let process = Process(), output = Pipe()
            process.executableURL = root.appendingPathComponent("node")
            process.arguments = [root.appendingPathComponent("integrations/mintbrew-ouncecake/save-import-files.cjs").path,
                                 action, folder.path] + (argument.map { [$0] } ?? [])
            process.currentDirectoryURL = root
            process.standardInput = FileHandle.nullDevice
            process.standardOutput = output; process.standardError = output
            try process.run()
            let bytes = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else {
                throw NSError(domain: "OunceCakeImport", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: String(decoding: bytes.prefix(4096), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)])
            }
            return bytes
        }.value
    }
    private func refresh() {
        guard !terminal else { return }
        if let data = try? Data(contentsOf: context.folder.appendingPathComponent("result.json")), data.count <= 65536,
           let result = try? JSONDecoder().decode(Result.self, from: data) {
            if let path = result.backupPath {
                let url = URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL
                let allowed = context.root.appendingPathComponent("savekit-exports/ouncecake-import").path + "/"
                let exports = context.folder.deletingLastPathComponent().deletingLastPathComponent()
                    .appendingPathComponent("save-backups").path + "/"
                if url.path.hasPrefix(allowed) || (context.request.transport == "webdav" && url.path.hasPrefix(exports)) {
                    backupURL = url
                }
            }
            if result.phase != lastPhase {
                lastPhase = result.phase
                switch result.phase {
                case "backup": submitted = true; status = "Backing up the current console save…"
                case "checking": submitted = true; status = "Checking that the console save and staged files have not changed…"
                case "writing": submitted = true; status = "Writing and committing save files. Keep the console connected and the game closed."
                case "verifying": submitted = true; status = "Reading the committed save back and checking every file…"
                case "complete":
                    terminal = true; success = result.verified == true
                    status = success ? "Save imported and verified. The original backup is kept on your Mac." : "Import did not confirm verification. Keep the backup and session logs."
                case "failed":
                    terminal = true; uncertain = result.writeMayHaveOccurred == true || result.cleanupBlocked == true
                    status = (result.message ?? "Save import failed.") + (uncertain ? " Writing may have occurred. Keep the backup and restart the console before recovery." : " No save import was completed.")
                case "cancelled": terminal = true; status = result.message ?? "Save import cancelled."
                default: break
                }
            }
        }
        if !terminal, kill(context.request.ownerPid, 0) != 0, errno == ESRCH {
            terminal = true; uncertain = submitted
            status = submitted ? "OunceCake disconnected before verification. Writing may have occurred. Keep the backup and session logs; restart the console before recovery." : "OunceCake closed before import. No import was confirmed."
        }
        if !submitted, Date().timeIntervalSince1970 * 1000 >= context.request.expires {
            terminal = true; status = "This request expired. Select the save archive again in OunceCake."
        }
        if terminal { busy = false; SaveImportQuitGuard.finish(self); stop(); onTerminal?(status) }
        else if submitted { SaveImportQuitGuard.begin(self) }
    }
}

struct OunceCakeImportView: View {
    @StateObject private var model: OunceCakeImportModel
    @Environment(\.dismiss) private var dismiss
    @OunceCakeImportState private var gameClosed = false
    @OunceCakeImportState private var overwriteConfirmed = false
    init(context: OunceCakeImportContext) { _model = StateObject(wrappedValue: OunceCakeImportModel(context: context)) }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Import save", systemImage: "square.and.arrow.down").font(.title2.weight(.semibold))
            Text(model.context.request.titleName).font(.headline).textSelection(.enabled)
            let archive = model.context.request.archive
            Text("\(archive.titleId) · \(archive.type == 1 ? "Account" : "Device") · \(archive.space == 1 ? "NAND" : "SD")")
                .font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
            Text(archive.uid == String(repeating: "0", count: 32) ? "Shared save" : "\(archive.userName ?? "User") [\(archive.uid)]")
                .font(.caption).textSelection(.enabled)
            Divider()
            Text(model.status).fixedSize(horizontal: false, vertical: true)
            if let source = model.source { Text(source.path).font(.caption).foregroundStyle(.secondary).lineLimit(2).textSelection(.enabled) }
            if let plan = model.plan, !model.submitted, !model.terminal {
                Text("\(plan.files) files · \(ByteCountFormatter.string(fromByteCount: Int64(plan.bytes), countStyle: .file)) · \(plan.changed) edited or new")
                    .font(.callout)
                Toggle("The game is fully closed on the console", isOn: $gameClosed)
                Toggle("Replace this archive's save files with the selected files", isOn: $overwriteConfirmed)
                Text("A verified backup is created first. Imported files are checked after commit. Game-specific checksums must already be valid.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if model.busy || (model.submitted && !model.terminal) { ProgressView().controlSize(.small) }
            if let url = model.backupURL { Button("Show original backup") { NSWorkspace.shared.open(url) } }
            HStack {
                if model.terminal { Button("Close") { dismiss() }.keyboardShortcut(.defaultAction) }
                else if model.context.request.transport != "webdav" {
                    Button("Cancel") { Task { await model.cancel() } }.disabled(model.busy || model.submitted)
                    Spacer()
                    Button("Choose save folder…") { gameClosed = false; overwriteConfirmed = false; model.choose() }
                        .disabled(model.busy || model.submitted)
                    Button("Back up and import") { Task { await model.confirm() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(model.plan == nil || !gameClosed || !overwriteConfirmed || model.busy || model.submitted)
                }
            }
        }
        .padding(24).frame(width: 590).fixedSize(horizontal: false, vertical: true)
        .interactiveDismissDisabled(!model.terminal)
        .onAppear { model.start() }.onDisappear { model.stop() }
    }
}
