import ExpoModulesCore

public class AgentRuntimeModule: Module {
  private let runtimeService = AgentRuntimeService()

  public func definition() -> ModuleDefinition {
    Name("AgentRuntime")

    AsyncFunction("runInference") { (request: [String: Any]) -> [String: Any] in
      runtimeService.runInference(requestDictionary: request)
    }

    AsyncFunction("listAvailableModels") { () -> [[String: Any]] in
      runtimeService.listAvailableModels()
    }

    AsyncFunction("getModelStatus") { () -> [String: Any] in
      runtimeService.getModelStatus()
    }

    AsyncFunction("downloadModel") { (modelId: String) -> [String: Any] in
      runtimeService.downloadModel(modelId: modelId)
    }
  }
}
