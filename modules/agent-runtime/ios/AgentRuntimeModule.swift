import ExpoModulesCore

public class AgentRuntimeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AgentRuntime")

    AsyncFunction("runInference") { (request: [String: Any]) -> [String: Any] in
      let goal = request["goal"] as? String ?? ""
      let screenshotUri = request["screenshotUri"] as? String ?? ""
      let axSnapshot = request["axSnapshot"] as? [[String: Any]] ?? []
      let actionHistory = request["actionHistory"] as? [[String: Any]] ?? []

      return [
        "action": "finish",
        "parameters": [
          "status": "stubbed",
          "message": "Native bridge ready for goal '\(goal)'. Screenshot: \(screenshotUri). AX nodes: \(axSnapshot.count). Prior actions: \(actionHistory.count)."
        ]
      ]
    }
  }
}
