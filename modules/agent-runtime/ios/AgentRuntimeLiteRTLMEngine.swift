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

  func infer(
    request: AgentRuntimeRequest,
    screenshot: ScreenshotArtifact,
    prompt: String
  ) throws -> AgentRuntimeSuccess {
    let installation = try modelManager.requireActiveInstallation()
    let response: [String: Any]

    do {
      response = try adapter.runInference(
        withModelPath: installation.modelFileURL.path,
        prompt: prompt,
        goal: request.goal,
        screenshotPath: screenshot.url.path,
        axNodeCount: NSNumber(value: request.axSnapshot.count)
      )
    } catch let adapterError as NSError {
      throw AgentRuntimeFailure(
        code: .modelLoadFailed,
        message: adapterError.localizedDescription,
        details: [
          "activeCommitHash": installation.model.commitHash,
          "activeModelId": installation.model.id,
          "modelPath": installation.modelFileURL.path
        ],
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

    return AgentRuntimeSuccess(
      action: action,
      parameters: parameters,
      backend: "litertlm",
      diagnostics: diagnostics
    )
  }
}
