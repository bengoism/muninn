import Foundation

final class AgentRuntimeLiteRTLMEngine: AgentInferenceEngine {
  private let adapter: LiteRTLMAdapter
  private let modelManager: AgentRuntimeModelManager

  init(
    adapter: LiteRTLMAdapter = LiteRTLMAdapter(),
    modelManager: AgentRuntimeModelManager
  ) {
    self.adapter = adapter
    self.modelManager = modelManager
  }

  private func sanitizeAdapterValue(_ value: Any) -> Any {
    switch value {
    case let dictionary as [String: Any]:
      return dictionary.mapValues { sanitizeAdapterValue($0) }
    case let array as [Any]:
      return array.map { sanitizeAdapterValue($0) }
    case let string as String:
      return string
    case let number as NSNumber:
      return number
    case _ as NSNull:
      return NSNull()
    case let date as Date:
      return ISO8601DateFormatter().string(from: date)
    case let url as URL:
      return url.absoluteString
    default:
      return String(describing: value)
    }
  }

  private func adapterFailureDetails(
    for adapterError: NSError,
    installation: AgentRuntimeModelInstallation
  ) -> [String: Any] {
    var details: [String: Any] = [
      "activeCommitHash": installation.model.commitHash,
      "activeModelId": installation.model.id,
      "modelPath": installation.modelFileURL.path,
      "adapterDomain": adapterError.domain,
      "adapterCode": adapterError.code
    ]

    if !adapterError.userInfo.isEmpty {
      details["adapterUserInfo"] = sanitizeAdapterValue(adapterError.userInfo)
    }

    return details
  }

  func infer(
    request: AgentRuntimeRequest,
    screenshot: ScreenshotArtifact,
    planningScreenshot: ScreenshotArtifact?,
    prompt: String
  ) throws -> AgentRuntimeSuccess {
    let installation = try modelManager.requireActiveInstallation()
    let runtimeConfig = installation.model.liteRTLMRuntimeConfig.asDictionary()
    let response: [String: Any]

    do {
      response = try adapter.runInference(
        withModelPath: installation.modelFileURL.path,
        runtimeConfig: runtimeConfig,
        prompt: prompt,
        goal: request.goal,
        screenshotPath: screenshot.url.path,
        planningScreenshotPath: planningScreenshot?.url.path,
        axNodeCount: NSNumber(value: request.axSnapshot.count)
      )
    } catch let adapterError as NSError {
      throw AgentRuntimeFailure(
        code: .modelLoadFailed,
        message: adapterError.localizedDescription,
        details: adapterFailureDetails(for: adapterError, installation: installation),
        backend: "litertlm"
      )
    }

    guard
      let action = response["action"] as? String,
      let parameters = response["parameters"] as? [String: Any]
    else {
      throw AgentRuntimeFailure(
        code: .invalidModelOutput,
        message: "LiteRT-LM returned an invalid structured action payload.",
        details: [
          "activeCommitHash": installation.model.commitHash,
          "activeModelId": installation.model.id,
          "responseKeys": Array(response.keys)
        ],
        backend: "litertlm"
      )
    }

    var diagnostics = response["diagnostics"] as? [String: Any] ?? [:]
    diagnostics["activeCommitHash"] = installation.model.commitHash
    diagnostics["activeModelId"] = installation.model.id
    diagnostics["modelPath"] = installation.modelFileURL.path
    diagnostics["planningContextReasons"] = request.planningContext?.reasons ?? []
    diagnostics["planningContextSummary"] = request.planningContext?.summary ?? NSNull()
    diagnostics["planningImageProvided"] = planningScreenshot != nil

    return AgentRuntimeSuccess(
      action: action,
      parameters: parameters,
      planUpdates: response["planUpdates"] as? [[String: Any]],
      backend: "litertlm",
      diagnostics: diagnostics
    )
  }

  func runLiteRTLMSmokeTest(prompt: String) throws -> AgentRuntimeLiteRTLMSmokeTestSuccess {
    let installation = try modelManager.requireActiveInstallation()
    let runtimeConfig = installation.model.liteRTLMRuntimeConfig.asDictionary()
    let response: [String: Any]

    do {
      response = try adapter.runTextSmokeTest(
        withModelPath: installation.modelFileURL.path,
        runtimeConfig: runtimeConfig,
        prompt: prompt
      )
    } catch let adapterError as NSError {
      throw AgentRuntimeFailure(
        code: .modelLoadFailed,
        message: adapterError.localizedDescription,
        details: adapterFailureDetails(for: adapterError, installation: installation),
        backend: "litertlm"
      )
    }

    guard
      let text = response["text"] as? String,
      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      throw AgentRuntimeFailure(
        code: .invalidModelOutput,
        message: "LiteRT-LM smoke test returned an empty text payload.",
        details: [
          "activeCommitHash": installation.model.commitHash,
          "activeModelId": installation.model.id,
          "responseKeys": Array(response.keys)
        ],
        backend: "litertlm"
      )
    }

    var diagnostics = response["diagnostics"] as? [String: Any] ?? [:]
    diagnostics["activeCommitHash"] = installation.model.commitHash
    diagnostics["activeModelId"] = installation.model.id
    diagnostics["modelPath"] = installation.modelFileURL.path

    return AgentRuntimeLiteRTLMSmokeTestSuccess(
      text: text,
      backend: "litertlm",
      diagnostics: diagnostics
    )
  }
}
