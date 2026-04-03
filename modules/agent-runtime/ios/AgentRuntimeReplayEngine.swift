import Foundation

protocol AgentInferenceEngine {
  func infer(
    request: AgentRuntimeRequest,
    screenshot: ScreenshotArtifact,
    prompt: String
  ) throws -> AgentRuntimeSuccess
}

final class AgentRuntimeReplayEngine: AgentInferenceEngine {
  func infer(
    request: AgentRuntimeRequest,
    screenshot: ScreenshotArtifact,
    prompt: String
  ) throws -> AgentRuntimeSuccess {
    let lastActionStatus = request.actionHistory.last?["status"] as? String ?? "none"

    return AgentRuntimeSuccess(
      action: "finish",
      parameters: [
        "status": "replay",
        "message": "Replay backend validated screenshot input and produced a typed action for goal '\(request.goal)'."
      ],
      backend: "replay",
      diagnostics: [
        "actionHistoryCount": request.actionHistory.count,
        "axNodeCount": request.axSnapshot.count,
        "lastActionStatus": lastActionStatus,
        "promptLength": prompt.count,
        "screenshotHeight": screenshot.pixelHeight,
        "screenshotWidth": screenshot.pixelWidth
      ]
    )
  }
}
