import Foundation

enum RuntimeMode: String {
  case replay = "replay"
  case litertlm = "litertlm"
}

enum InferenceFailureCode: String {
  case invalidRequest = "invalid_request"
  case screenshotNotFound = "screenshot_not_found"
  case screenshotLoadFailed = "screenshot_load_failed"
  case modelNotConfigured = "model_not_configured"
  case modelLoadFailed = "model_load_failed"
  case invalidModelOutput = "invalid_model_output"
  case unsupportedAction = "unsupported_action"
  case missingParameter = "missing_parameter"
  case memoryPressure = "memory_pressure"
  case timeout = "timeout"
  case internalError = "internal_error"
}

struct AgentRuntimeRequest {
  let goal: String
  let screenshotUri: String
  let screenshotUrl: URL
  let planningContext: AgentRuntimePlanningContext?
  let targetSummary: [String: Any]?
  let axSnapshot: [[String: Any]]
  let axTreeText: String
  let actionHistory: [[String: Any]]
  let sessionPlan: [String: Any]?
  let runtimeMode: RuntimeMode

  init(dictionary: [String: Any]) throws {
    guard let goal = dictionary["goal"] as? String else {
      throw AgentRuntimeFailure(
        code: .invalidRequest,
        message: "The inference request is missing a goal string.",
        backend: "bridge"
      )
    }

    guard let screenshotUri = dictionary["screenshotUri"] as? String else {
      throw AgentRuntimeFailure(
        code: .invalidRequest,
        message: "The inference request is missing a screenshotUri string.",
        backend: "bridge"
      )
    }

    guard let screenshotUrl = URL(string: screenshotUri), screenshotUrl.isFileURL else {
      throw AgentRuntimeFailure(
        code: .invalidRequest,
        message: "The inference request must provide a file URI for the screenshot.",
        details: [
          "screenshotUri": screenshotUri
        ],
        backend: "bridge"
      )
    }

    let runtimeModeValue = dictionary["runtimeMode"] as? String ?? RuntimeMode.replay.rawValue

    guard let runtimeMode = RuntimeMode(rawValue: runtimeModeValue) else {
      throw AgentRuntimeFailure(
        code: .invalidRequest,
        message: "The inference request must provide a supported runtimeMode.",
        details: [
          "runtimeMode": runtimeModeValue
        ],
        backend: "bridge"
      )
    }

    self.goal = goal
    self.screenshotUri = screenshotUri
    self.screenshotUrl = screenshotUrl
    self.planningContext = try AgentRuntimePlanningContext(dictionary: dictionary["planningContext"])
    self.targetSummary = dictionary["targetSummary"] as? [String: Any]
    self.axSnapshot = dictionary["axSnapshot"] as? [[String: Any]] ?? []
    self.axTreeText = dictionary["axTreeText"] as? String ?? ""
    self.actionHistory = dictionary["actionHistory"] as? [[String: Any]] ?? []
    self.sessionPlan = dictionary["sessionPlan"] as? [String: Any]
    self.runtimeMode = runtimeMode
  }
}

struct ScreenshotArtifact {
  let url: URL
  let pixelWidth: Int
  let pixelHeight: Int
}

struct AgentRuntimePlanningContext {
  let fullPageScreenshotUri: String
  let fullPageScreenshotUrl: URL
  let reasons: [String]
  let summary: String

  init?(dictionary: Any?) throws {
    guard let dictionary = dictionary as? [String: Any] else {
      return nil
    }

    guard
      let fullPageScreenshotUri = dictionary["fullPageScreenshotUri"] as? String,
      let fullPageScreenshotUrl = URL(string: fullPageScreenshotUri),
      fullPageScreenshotUrl.isFileURL
    else {
      throw AgentRuntimeFailure(
        code: .invalidRequest,
        message: "The planningContext must provide a valid fullPageScreenshotUri file URL.",
        details: [
          "planningContext": dictionary
        ],
        backend: "bridge"
      )
    }

    self.fullPageScreenshotUri = fullPageScreenshotUri
    self.fullPageScreenshotUrl = fullPageScreenshotUrl
    self.reasons = dictionary["reasons"] as? [String] ?? []
    self.summary = dictionary["summary"] as? String ?? ""
  }
}

struct AgentRuntimeSuccess {
  let action: String
  let parameters: [String: Any]
  let planUpdates: [[String: Any]]?
  let backend: String
  let diagnostics: [String: Any]?

  func asDictionary() -> [String: Any] {
    [
      "ok": true,
      "action": action,
      "parameters": parameters,
      "planUpdates": planUpdates ?? NSNull(),
      "backend": backend,
      "diagnostics": diagnostics ?? NSNull()
    ]
  }
}

struct AgentRuntimeLiteRTLMSmokeTestSuccess {
  let text: String
  let backend: String
  let diagnostics: [String: Any]?

  func asDictionary() -> [String: Any] {
    [
      "ok": true,
      "text": text,
      "backend": backend,
      "diagnostics": diagnostics ?? NSNull()
    ]
  }
}

struct AgentRuntimeModelCatalogEntry {
  let id: String
  let displayName: String
  let modelId: String
  let commitHash: String
  let filename: String
  let approximateSizeBytes: Int64
  let downloaded: Bool
  let active: Bool

  func asDictionary() -> [String: Any] {
    [
      "id": id,
      "displayName": displayName,
      "modelId": modelId,
      "commitHash": commitHash,
      "filename": filename,
      "approximateSizeBytes": NSNumber(value: approximateSizeBytes),
      "downloaded": downloaded,
      "active": active
    ]
  }
}

struct AgentRuntimeModelStatus {
  let activeModelId: String?
  let activeCommitHash: String?
  let isDownloading: Bool
  let downloadedBytes: Int64
  let totalBytes: Int64
  let lastError: String?

  func asDictionary() -> [String: Any] {
    [
      "activeModelId": activeModelId ?? NSNull(),
      "activeCommitHash": activeCommitHash ?? NSNull(),
      "isDownloading": isDownloading,
      "downloadedBytes": NSNumber(value: downloadedBytes),
      "totalBytes": NSNumber(value: totalBytes),
      "lastError": lastError ?? NSNull()
    ]
  }
}

struct AgentRuntimeFailure: Error {
  let code: InferenceFailureCode
  let message: String
  let details: [String: Any]?
  let retryable: Bool
  let backend: String

  init(
    code: InferenceFailureCode,
    message: String,
    details: [String: Any]? = nil,
    retryable: Bool = false,
    backend: String
  ) {
    self.code = code
    self.message = message
    self.details = details
    self.retryable = retryable
    self.backend = backend
  }

  func asDictionary() -> [String: Any] {
    [
      "ok": false,
      "code": code.rawValue,
      "message": message,
      "details": details ?? NSNull(),
      "retryable": retryable,
      "backend": backend
    ]
  }
}

enum AgentRuntimeLiteRTLMSamplerType: String {
  case topK = "top_k"
  case topP = "top_p"
  case greedy = "greedy"
}

struct AgentRuntimeLiteRTLMSamplerConfig {
  let type: AgentRuntimeLiteRTLMSamplerType
  let topK: Int
  let topP: Float
  let temperature: Float
  let seed: Int

  func asDictionary() -> [String: Any] {
    [
      "type": type.rawValue,
      "topK": NSNumber(value: topK),
      "topP": NSNumber(value: topP),
      "temperature": NSNumber(value: temperature),
      "seed": NSNumber(value: seed)
    ]
  }
}

struct AgentRuntimeLiteRTLMRuntimeConfig {
  let preferredBackends: [String]
  let maxNumTokens: Int
  let maxOutputTokens: Int
  let sampler: AgentRuntimeLiteRTLMSamplerConfig
  let enableVerboseNativeLogging: Bool

  func asDictionary() -> [String: Any] {
    [
      "preferredBackends": preferredBackends,
      "maxNumTokens": NSNumber(value: maxNumTokens),
      "maxOutputTokens": NSNumber(value: maxOutputTokens),
      "sampler": sampler.asDictionary(),
      "enableVerboseNativeLogging": enableVerboseNativeLogging
    ]
  }
}

struct AgentRuntimeAllowlistedModel {
  let id: String
  let displayName: String
  let modelId: String
  let commitHash: String
  let filename: String
  let approximateSizeBytes: Int64
  let liteRTLMRuntimeConfig: AgentRuntimeLiteRTLMRuntimeConfig

  var downloadUrl: URL {
    URL(
      string:
        "https://huggingface.co/\(modelId)/resolve/\(commitHash)/\(filename)?download=true"
    )!
  }

  var sanitizedModelId: String {
    id.replacingOccurrences(
      of: "[^A-Za-z0-9_-]",
      with: "_",
      options: .regularExpression
    )
  }

  func asCatalogEntry(downloaded: Bool, active: Bool) -> AgentRuntimeModelCatalogEntry {
    AgentRuntimeModelCatalogEntry(
      id: id,
      displayName: displayName,
      modelId: modelId,
      commitHash: commitHash,
      filename: filename,
      approximateSizeBytes: approximateSizeBytes,
      downloaded: downloaded,
      active: active
    )
  }

  static let gemma4E2B = AgentRuntimeAllowlistedModel(
    id: "gemma-4-e2b-it",
    displayName: "Gemma 4 E2B",
    modelId: "litert-community/gemma-4-E2B-it-litert-lm",
    commitHash: "ba27655a791cd872631e8cd9c3521d0a433ba9bf",
    filename: "gemma-4-E2B-it.litertlm",
    approximateSizeBytes: 2_583_085_056,
    liteRTLMRuntimeConfig: AgentRuntimeLiteRTLMRuntimeConfig(
      preferredBackends: ["cpu", "gpu"],
      maxNumTokens: 6144,
      maxOutputTokens: 1024,
      sampler: AgentRuntimeLiteRTLMSamplerConfig(
        type: .topP,
        topK: 1,
        topP: 0.95,
        temperature: 1.0,
        seed: 0
      ),
      enableVerboseNativeLogging: true
    )
  )
}

struct AgentRuntimeModelState: Codable {
  var activeModelId: String?
  var activeCommitHash: String?
}

struct AgentRuntimeInstallMetadata: Codable {
  let id: String
  let displayName: String
  let modelId: String
  let commitHash: String
  let filename: String
  let approximateSizeBytes: Int64
  let installedBytes: Int64
  let installedAt: String
}

struct AgentRuntimeModelInstallation {
  let model: AgentRuntimeAllowlistedModel
  let installDirectoryURL: URL
  let modelFileURL: URL
  let metadataURL: URL
}
