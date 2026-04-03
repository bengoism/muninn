import ExpoModulesCore

public class AgentRuntimeModule: Module {
  private let runtimeService = AgentRuntimeService()

  public func definition() -> ModuleDefinition {
    Name("AgentRuntime")

    AsyncFunction("runInference") { (request: [String: Any]) -> [String: Any] in
      runtimeService.runInference(requestDictionary: request)
    }
  }
}
