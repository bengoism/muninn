import Foundation

final class AgentRuntimePromptBuilder {

  private static let actionSchema = """
    Available actions:
    - click(id: string) — click an element by its ref ID
    - tap_coordinates(x: number, y: number) — tap at screen coordinates
    - type(id: string, text: string) — type text into an input element
    - scroll(direction: "up"|"down"|"left"|"right", amount: "page"|"half"|"small")
    - go_back() — navigate back
    - wait(condition: string) — wait for a condition
    - yield_to_user(reason: string) — ask the user for help
    - finish(status: "success"|"failure", message: string) — task complete

    Elements with [ref=...] are interactive. Use the ref value as the "id" parameter for click and type actions.
    """

  func buildPrompt(
    for request: AgentRuntimeRequest,
    screenshot: ScreenshotArtifact
  ) -> String {
    var parts: [String] = []

    parts.append("You are a browser agent. You see a screenshot of a webpage and must decide the single next action to achieve the user's goal.")
    parts.append("If the goal has already been achieved based on what you see, call finish(status: \"success\", message: \"...\").")
    parts.append("Do not keep taking actions after the goal is complete.")
    parts.append("")
    parts.append("Goal: \(request.goal)")
    parts.append("")
    parts.append("Viewport: \(screenshot.pixelWidth)x\(screenshot.pixelHeight)")
    parts.append("")

    let axSummary = request.axTreeText.isEmpty
      ? buildAXSummary(request.axSnapshot)
      : request.axTreeText
    if !axSummary.isEmpty {
      parts.append("Page content and interactive elements:")
      parts.append(axSummary)
      parts.append("")
    }

    if !request.actionHistory.isEmpty {
      parts.append("Actions already taken (most recent last):")
      parts.append(buildActionHistory(request.actionHistory))
      parts.append("If these actions already achieved the goal, call finish.")
      parts.append("")
    }

    parts.append(Self.actionSchema)
    parts.append("")
    parts.append("Respond with exactly one JSON object: {\"action\": \"<name>\", \"parameters\": {<params>}}")
    parts.append("Do not include any text before or after the JSON.")

    return parts.joined(separator: "\n")
  }

  private func buildAXSummary(_ nodes: [[String: Any]]) -> String {
    let visibleNodes = nodes.filter { $0["isVisible"] as? Bool == true }
    let summaryNodes = visibleNodes.prefix(40)

    let lines: [String] = summaryNodes.compactMap { node in
      let role = node["role"] as? String ?? ""
      let id = node["id"] as? String ?? ""
      let label = node["label"] as? String ?? ""
      let text = node["text"] as? String ?? ""
      let placeholder = node["placeholder"] as? String ?? ""

      var desc = role
      if !id.isEmpty { desc += " id=\"\(id)\"" }
      if !label.isEmpty { desc += " label=\"\(label)\"" }
      if !text.isEmpty && text != label { desc += " text=\"\(text.prefix(80))\"" }
      if !placeholder.isEmpty { desc += " placeholder=\"\(placeholder)\"" }

      return desc.isEmpty ? nil : "  - \(desc)"
    }

    return lines.joined(separator: "\n")
  }

  private func buildActionHistory(_ history: [[String: Any]]) -> String {
    let recent = history.suffix(3)
    let lines: [String] = recent.compactMap { entry in
      let action = entry["action"] as? String ?? "unknown"
      let status = entry["status"] as? String ?? ""
      let params = entry["parameters"] as? [String: Any] ?? [:]
      let urlBefore = entry["urlBefore"] as? String
      let urlAfter = entry["urlAfter"] as? String

      var paramSummary = params.map { "\($0.key)=\($0.value)" }.joined(separator: ", ")
      if !paramSummary.isEmpty { paramSummary = "(\(paramSummary))" }

      var line = "  - \(action)\(paramSummary) → \(status)"

      if let before = urlBefore, let after = urlAfter, before != after {
        line += " (page navigated from \(before) to \(after))"
      }

      return line
    }
    return lines.joined(separator: "\n")
  }
}
