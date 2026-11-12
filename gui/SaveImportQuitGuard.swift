import AppKit

// Retain the progress observer if its window closes while a confirmed import
// is running. A normal Quit must not tear down the held RPC beneath a write.
@MainActor enum SaveImportQuitGuard {
    private static var operations: [String: OunceCakeImportModel] = [:]
    static var isActive: Bool { !operations.isEmpty }
    static func contains(_ model: OunceCakeImportModel) -> Bool { operations[model.context.id] != nil }
    static func begin(_ model: OunceCakeImportModel) { operations[model.context.id] = model }
    static func finish(_ model: OunceCakeImportModel) { operations.removeValue(forKey: model.context.id) }
}

@MainActor final class Mac2jbApplicationDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard SaveImportQuitGuard.isActive else { return .terminateNow }
        sender.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Save import is still running"
        alert.informativeText = "Finish or cancel the import in OunceCake. If writing has started, wait for verification before quitting."
        alert.addButton(withTitle: "Keep mac2jb open")
        alert.runModal()
        return .terminateCancel
    }
}
