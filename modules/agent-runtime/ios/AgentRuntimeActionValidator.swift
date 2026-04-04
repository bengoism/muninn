import Foundation

final class AgentRuntimeActionValidator {
  private let supportedActions: Set<String> = [
    "click",
    "tap_coordinates",
    "type",
    "fill",
    "select",
    "scroll",
    "go_back",
    "wait",
    "yield_to_user",
    "finish"
  ]

  func validate(_ candidate: AgentRuntimeSuccess) throws -> AgentRuntimeSuccess {
    guard supportedActions.contains(candidate.action) else {
      throw AgentRuntimeFailure(
        code: .unsupportedAction,
        message: "The runtime produced an unsupported action.",
        details: [
          "action": candidate.action
        ],
        backend: candidate.backend
      )
    }

    switch candidate.action {
    case "click":
      try requireString(named: "id", in: candidate)
    case "tap_coordinates":
      try requireNumber(named: "x", in: candidate)
      try requireNumber(named: "y", in: candidate)
    case "type":
      try requireString(named: "id", in: candidate)
      try requireString(named: "text", in: candidate)
    case "fill":
      try requireString(named: "id", in: candidate)
      try requireString(named: "text", in: candidate)
    case "select":
      try requireString(named: "id", in: candidate)
      try requireString(named: "value", in: candidate)
    case "scroll":
      try requireString(named: "direction", in: candidate)
      try requireString(named: "amount", in: candidate)
    case "wait":
      guard candidate.parameters["condition"] is String || candidate.parameters["condition"] is NSNumber else {
        throw AgentRuntimeFailure(
          code: .missingParameter,
          message: "The runtime produced an invalid wait action.",
          details: [
            "action": candidate.action,
            "missingParameter": "condition"
          ],
          backend: candidate.backend
        )
      }
    case "yield_to_user":
      try requireString(named: "reason", in: candidate)
    case "finish":
      try requireString(named: "status", in: candidate)
      try requireString(named: "message", in: candidate)
    case "go_back":
      break
    default:
      break
    }

    return candidate
  }

  private func requireString(named parameter: String, in candidate: AgentRuntimeSuccess) throws {
    if let value = candidate.parameters[parameter] as? String, !value.isEmpty {
      return
    }

    throw AgentRuntimeFailure(
      code: .missingParameter,
      message: "The runtime produced an invalid action payload.",
      details: [
        "action": candidate.action,
        "missingParameter": parameter
      ],
      backend: candidate.backend
    )
  }

  private func requireNumber(named parameter: String, in candidate: AgentRuntimeSuccess) throws {
    if candidate.parameters[parameter] is NSNumber {
      return
    }

    throw AgentRuntimeFailure(
      code: .missingParameter,
      message: "The runtime produced an invalid action payload.",
      details: [
        "action": candidate.action,
        "missingParameter": parameter
      ],
      backend: candidate.backend
    )
  }
}
