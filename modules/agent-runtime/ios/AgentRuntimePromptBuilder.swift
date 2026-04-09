import Foundation

final class AgentRuntimePromptBuilder {

  private static let actionSchema = """
    Available actions:
    - click(id: string) — click an element by its ref ID
    - tap_coordinates(x: number, y: number) — tap at screen coordinates
    - type(id: string, text: string) — type text into an input (appends)
    - fill(id: string, text: string) — clear input and set new text
    - select(id: string, value: string) — pick a dropdown option by value or text
    - gettext(id: string) — read text content of an element (returns text in reason field)
    - hover(id: string) — hover over an element to trigger menus or tooltips
    - focus(id: string) — focus an element
    - eval(code: string) — run JavaScript in the page and return the result
    - scroll(direction: "up"|"down"|"left"|"right", amount: "page"|"half"|"small")
    - go_back() — navigate back
    - wait(condition: string) — wait for condition: "idle", "url:<pattern>", "selector:<css>", "text:<substring>"
    - yield_to_user(reason: string) — ask the user for help
    - finish(status: "success"|"failure", message: string) — task complete

    IMPORTANT: Elements with [ref=...] are interactive. You MUST use the exact short ref value (e.g. "e1") as the "id" parameter. Never use the element's label, description, or a DOM id like "ai-main-abc-123" as the id.
    Prefer semantic refs such as links, buttons, searchboxes, textboxes, and comboboxes. Treat generic clickable refs as exploratory fallbacks, not first-choice targets, especially on results pages.
    Use the Target guidance section to understand which refs are editable, exploratory, preferred, or lower priority for the current step.
    If typing into a field has no effect, try clicking or focusing the field, then observe again. If that opens a modal, sheet, fullscreen editor, or expanded picker, retarget the actual active input before typing.
    If the active todo is still to open or inspect a result, do not call finish just because a results page is visible.
    Read the current todo list before each step. After choosing the next action, you may optionally propose bounded plan updates in a top-level "plan_updates" array. The runtime validates these updates before applying them.
    Allowed plan updates:
    - {"type":"add_item","text":"...", "activate":true|false}
    - {"type":"set_active_item","id":"todo-results"}
    - {"type":"complete_item","id":"todo-results","evidence":"..."}
    - {"type":"reopen_item","id":"todo-form","evidence":"..."}
    - {"type":"drop_item","id":"todo-model-1","reason":"..."}
    - {"type":"set_phase","phase":"results","evidence":"..."}
    Never claim a todo is complete unless the current page already provides evidence.
    """

  func buildPrompt(
    for request: AgentRuntimeRequest,
    screenshot: ScreenshotArtifact,
    planningScreenshot: ScreenshotArtifact?
  ) -> String {
    var parts: [String] = []

    parts.append("You are a browser agent. You see one or two screenshots of a webpage and must decide the single next action to achieve the user's goal.")
    parts.append("The first image is always the current viewport. If a second image is present, it is a downscaled full-page overview of the same page for planning only.")
    parts.append("If the goal has already been achieved based on what you see, call finish(status: \"success\", message: \"...\").")
    parts.append("Do not keep taking actions after the goal is complete.")
    parts.append("")
    parts.append("Goal: \(request.goal)")
    parts.append("")

    if let planSummary = buildPlanSummary(request.sessionPlan) {
      parts.append("Current plan:")
      parts.append(planSummary)
      parts.append("")
    }

    if let targetSummary = buildTargetSummary(request.targetSummary) {
      parts.append("Target guidance:")
      parts.append(targetSummary)
      parts.append("")
    }

    parts.append("Viewport: \(screenshot.pixelWidth)x\(screenshot.pixelHeight)")
    parts.append("")

    if let planningContext = request.planningContext {
      parts.append("Planning context:")
      if let planningScreenshot {
        parts.append("Full-page overview: \(planningScreenshot.pixelWidth)x\(planningScreenshot.pixelHeight)")
      } else {
        parts.append("Full-page overview: requested but unavailable")
      }
      if !planningContext.reasons.isEmpty {
        parts.append("Why richer context was requested: \(planningContext.reasons.joined(separator: ", "))")
      }
      if !planningContext.summary.isEmpty {
        parts.append("Planning summary: \(planningContext.summary)")
      }
      parts.append("Use the overview image to understand page layout and off-screen content, but use the viewport image and refs for precise interaction.")
      parts.append("")
    }

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
    parts.append("Respond with exactly one JSON object: {\"action\": \"<name>\", \"parameters\": {<params>}, \"plan_updates\": [optional bounded updates]}")
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

  private func buildPlanSummary(_ plan: [String: Any]?) -> String? {
    guard let plan else {
      return nil
    }

    var lines: [String] = []

    if let phase = plan["phase"] as? String, !phase.isEmpty {
      lines.append("Current phase: \(phase)")
    }

    if
      let items = plan["items"] as? [[String: Any]],
      !items.isEmpty
    {
      lines.append("Todos:")
      for item in items.prefix(5) {
        guard
          let id = item["id"] as? String,
          !id.isEmpty,
          let text = item["text"] as? String,
          !text.isEmpty
        else {
          continue
        }

        let status = item["status"] as? String ?? "pending"
        lines.append("- \(id) [\(status)]: \(text)")
      }

      let activeItemId = plan["activeItemId"] as? String
      if
        let activeItemId,
        let activeItem = items.first(where: { ($0["id"] as? String) == activeItemId }),
        let activeText = activeItem["text"] as? String,
        !activeText.isEmpty
      {
        lines.append("Active todo: \(activeText)")
      }

      let completed = items
        .filter { ($0["status"] as? String) == "completed" }
        .compactMap { $0["text"] as? String }
        .prefix(2)

      if !completed.isEmpty {
        lines.append("Completed: \(completed.joined(separator: "; "))")
      }

      let pending = items
        .filter { item in
          guard let text = item["text"] as? String, !text.isEmpty else {
            return false
          }
          let status = item["status"] as? String ?? ""
          let id = item["id"] as? String
          return (status == "pending" || status == "in_progress") && id != activeItemId
        }
        .compactMap { $0["text"] as? String }
        .prefix(2)

      if !pending.isEmpty {
        lines.append("Pending: \(pending.joined(separator: "; "))")
      }
    }

    if
      let avoidRefs = plan["avoidRefs"] as? [[String: Any]],
      !avoidRefs.isEmpty
    {
      let rendered = avoidRefs.prefix(2).compactMap { entry -> String? in
        guard let ref = entry["ref"] as? String, !ref.isEmpty else {
          return nil
        }
        let reason = (entry["reason"] as? String)?
          .trimmingCharacters(in: .whitespacesAndNewlines)
        if let reason, !reason.isEmpty {
          return "\(ref) because \(reason)"
        }
        return ref
      }

      if !rendered.isEmpty {
        lines.append("Avoid for now: \(rendered.joined(separator: "; "))")
      }
    }

    if
      let lastConfirmedProgress = plan["lastConfirmedProgress"] as? String,
      !lastConfirmedProgress.isEmpty
    {
      lines.append("Last confirmed progress: \(lastConfirmedProgress)")
    }

    return lines.isEmpty ? nil : lines.joined(separator: "\n")
  }

  private func buildTargetSummary(_ summary: [String: Any]?) -> String? {
    guard let summary else {
      return nil
    }

    var lines: [String] = []
    var renderedIds = Set<String>()
    appendTargetSection(title: "Preferred now", key: "preferred", from: summary, renderedIds: &renderedIds, to: &lines)
    appendTargetSection(title: "Editable now", key: "editable", from: summary, renderedIds: &renderedIds, to: &lines)
    appendTargetSection(title: "Exploratory openers", key: "exploratory", from: summary, renderedIds: &renderedIds, to: &lines)
    appendTargetSection(title: "Lower priority now", key: "lowerPriority", from: summary, renderedIds: &renderedIds, to: &lines)

    return lines.isEmpty ? nil : lines.joined(separator: "\n")
  }

  private func appendTargetSection(
    title: String,
    key: String,
    from summary: [String: Any],
    renderedIds: inout Set<String>,
    to lines: inout [String]
  ) {
    guard
      let items = summary[key] as? [[String: Any]],
      !items.isEmpty
    else {
      return
    }

    var renderedLines: [String] = []
    for item in items {
      guard let id = item["id"] as? String, !id.isEmpty else {
        continue
      }
      if renderedIds.contains(id) {
        continue
      }

      let targetType = item["targetType"] as? String ?? "semantic"
      let role = item["role"] as? String ?? "generic"
      let label = (item["label"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      let capabilities = item["capabilities"] as? [String] ?? []
      let affordances = item["affordances"] as? [String] ?? []

      var line = "- \(id) | \(targetType) | \(role)"
      if !capabilities.isEmpty {
        line += " | \(capabilities.joined(separator: ","))"
      }
      if !affordances.isEmpty {
        line += " | \(affordances.prefix(2).joined(separator: ","))"
      }
      if !label.isEmpty {
        line += " | \"\(label)\""
      }
      renderedLines.append(line)
      renderedIds.insert(id)
      if renderedLines.count >= 3 {
        break
      }
    }

    guard !renderedLines.isEmpty else {
      return
    }

    lines.append("\(title):")
    lines.append(contentsOf: renderedLines)
  }

  private func buildActionHistory(_ history: [[String: Any]]) -> String {
    let total = history.count
    var lines: [String] = []

    // Summary line when there's more history than shown.
    if total > 5 {
      let succeeded = history.filter { ($0["status"] as? String) == "succeeded" }.count
      let failed = total - succeeded
      lines.append("  (session: \(total) actions, \(succeeded) succeeded, \(failed) failed)")
    }

    // Show last 5 in detail.
    let recent = history.suffix(5)
    for entry in recent {
      let action = entry["action"] as? String ?? "unknown"
      let status = entry["status"] as? String ?? ""
      let params = entry["parameters"] as? [String: Any] ?? [:]
      let urlBefore = entry["urlBefore"] as? String
      let urlAfter = entry["urlAfter"] as? String

      var paramSummary = params.map { "\($0.key)=\($0.value)" }.joined(separator: ", ")
      if !paramSummary.isEmpty { paramSummary = "(\(paramSummary))" }

      var line = "  - \(action)\(paramSummary) → \(status)"

      if let before = urlBefore, let after = urlAfter, before != after {
        line += " (navigated to \(after))"
      }

      lines.append(line)
    }
    return lines.joined(separator: "\n")
  }
}
