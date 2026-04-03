import Foundation

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
  let axSnapshot: [[String: Any]]
  let actionHistory: [[String: Any]]

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

    self.goal = goal
    self.screenshotUri = screenshotUri
    self.screenshotUrl = screenshotUrl
    self.axSnapshot = dictionary["axSnapshot"] as? [[String: Any]] ?? []
    self.actionHistory = dictionary["actionHistory"] as? [[String: Any]] ?? []
  }
}

struct ScreenshotArtifact {
  let url: URL
  let pixelWidth: Int
  let pixelHeight: Int
}

struct AgentRuntimeSuccess {
  let action: String
  let parameters: [String: Any]
  let backend: String
  let diagnostics: [String: Any]?

  func asDictionary() -> [String: Any] {
    [
      "ok": true,
      "action": action,
      "parameters": parameters,
      "backend": backend,
      "diagnostics": diagnostics ?? NSNull()
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
