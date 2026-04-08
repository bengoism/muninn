import Foundation

protocol AgentInferenceEngine {
  func infer(
    request: AgentRuntimeRequest,
    screenshot: ScreenshotArtifact,
    planningScreenshot: ScreenshotArtifact?,
    prompt: String
  ) throws -> AgentRuntimeSuccess
}

final class AgentRuntimeReplayEngine: AgentInferenceEngine {
  func infer(
    request: AgentRuntimeRequest,
    screenshot: ScreenshotArtifact,
    planningScreenshot: ScreenshotArtifact?,
    prompt: String
  ) throws -> AgentRuntimeSuccess {
    let lastActionStatus = request.actionHistory.last?["status"] as? String ?? "none"

    return AgentRuntimeSuccess(
      action: "finish",
      parameters: [
        "status": "replay",
        "message": "Replay backend validated screenshot input and produced a typed action for goal '\(request.goal)'."
      ],
      planUpdates: nil,
      backend: "replay",
      diagnostics: [
        "actionHistoryCount": request.actionHistory.count,
        "axNodeCount": request.axSnapshot.count,
        "lastActionStatus": lastActionStatus,
        "planningContextReasons": request.planningContext?.reasons ?? [],
        "planningImageProvided": planningScreenshot != nil,
        "promptLength": prompt.count,
        "screenshotHeight": screenshot.pixelHeight,
        "screenshotWidth": screenshot.pixelWidth
      ]
    )
  }
}
