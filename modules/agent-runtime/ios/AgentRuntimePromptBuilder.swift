import Foundation

final class AgentRuntimePromptBuilder {
  func buildPrompt(
    for request: AgentRuntimeRequest,
    screenshot: ScreenshotArtifact
  ) -> String {
    let visibleNodeCount = request.axSnapshot.reduce(into: 0) { count, node in
      if node["isVisible"] as? Bool == true {
        count += 1
      }
    }

    let previewLabels = request.axSnapshot.compactMap { node -> String? in
      if let label = node["label"] as? String, !label.isEmpty {
        return label
      }

      if let text = node["text"] as? String, !text.isEmpty {
        return text
      }

      if let placeholder = node["placeholder"] as? String, !placeholder.isEmpty {
        return placeholder
      }

      return nil
    }

    let axPreview = previewLabels.prefix(5).joined(separator: " | ")

    return [
      "Goal: \(request.goal)",
      "Screenshot: \(screenshot.pixelWidth)x\(screenshot.pixelHeight)",
      "AX nodes: \(request.axSnapshot.count)",
      "Visible AX nodes: \(visibleNodeCount)",
      "Action history entries: \(request.actionHistory.count)",
      "AX preview: \(axPreview.isEmpty ? "none" : axPreview)"
    ].joined(separator: "\n")
  }
}
