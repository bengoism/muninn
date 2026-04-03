import Foundation

final class AgentRuntimeService {
  private let actionValidator: AgentRuntimeActionValidator
  private let litertEngine: AgentInferenceEngine
  private let modelManager: AgentRuntimeModelManager
  private let promptBuilder: AgentRuntimePromptBuilder
  private let replayEngine: AgentInferenceEngine
  private let screenshotLoader: AgentRuntimeScreenshotLoader

  init(
    actionValidator: AgentRuntimeActionValidator = AgentRuntimeActionValidator(),
    modelManager: AgentRuntimeModelManager = AgentRuntimeModelManager(),
    promptBuilder: AgentRuntimePromptBuilder = AgentRuntimePromptBuilder(),
    screenshotLoader: AgentRuntimeScreenshotLoader = AgentRuntimeScreenshotLoader()
  ) {
    self.actionValidator = actionValidator
    self.modelManager = modelManager
    self.promptBuilder = promptBuilder
    self.replayEngine = AgentRuntimeReplayEngine()
    self.litertEngine = AgentRuntimeLiteRTLMEngine(modelManager: modelManager)
    self.screenshotLoader = screenshotLoader
  }

  func runInference(requestDictionary: [String: Any]) -> [String: Any] {
    do {
      let request = try AgentRuntimeRequest(dictionary: requestDictionary)
      let screenshot = try screenshotLoader.load(from: request.screenshotUrl)
      let prompt = promptBuilder.buildPrompt(for: request, screenshot: screenshot)
      let candidate = try engine(for: request).infer(
        request: request,
        screenshot: screenshot,
        prompt: prompt
      )
      let validatedAction = try actionValidator.validate(candidate)
      return validatedAction.asDictionary()
    } catch let failure as AgentRuntimeFailure {
      return failure.asDictionary()
    } catch {
      return AgentRuntimeFailure(
        code: .internalError,
        message: error.localizedDescription,
        backend: "service"
      ).asDictionary()
    }
  }

  func listAvailableModels() -> [[String: Any]] {
    modelManager.listAvailableModels()
  }

  func getModelStatus() -> [String: Any] {
    modelManager.getModelStatus()
  }

  func downloadModel(modelId: String) -> [String: Any] {
    modelManager.downloadModel(modelId: modelId)
  }

  private func engine(for request: AgentRuntimeRequest) -> AgentInferenceEngine {
    switch request.runtimeMode {
    case .replay:
      replayEngine
    case .litertlm:
      litertEngine
    }
  }
}
