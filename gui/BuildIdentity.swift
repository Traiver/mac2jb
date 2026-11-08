import Foundation

enum AppBuildIdentity {
    static var isTestBuild: Bool {
        Bundle.main.object(forInfoDictionaryKey: "MAC2JBTestBuild") as? Bool ?? false
    }

    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.7.6"
    }

    static var buildNumber: Int? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String else { return nil }
        return try? UpdateBuild.parse(value)
    }

    static func releaseLabel(_ version: String, build: Int?) -> String {
        guard let build, build > 0 else { return "v\(version)" }
        return "v\(version) · Build \(build)"
    }

    static var versionLabel: String {
        releaseLabel(version, build: buildNumber) + (isTestBuild ? " · test build" : "")
    }

    static var diagnosticLabel: String {
        "mac2jb \(versionLabel)"
    }

    static let updatesDisabledMessage = "Updates are disabled for this local test build."
}
