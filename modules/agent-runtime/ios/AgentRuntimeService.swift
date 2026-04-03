import Foundation

final class AgentRuntimeService {
  private let actionValidator: AgentRuntimeActionValidator
  private let engine: AgentInferenceEngine
  private let promptBuilder: AgentRuntimePromptBuilder
  private let screenshotLoader: AgentRuntimeScreenshotLoader

  init(
    actionValidator: AgentRuntimeActionValidator = AgentRuntimeActionValidator(),
    engine: AgentInferenceEngine = AgentRuntimeReplayEngine(),
    promptBuilder: AgentRuntimePromptBuilder = AgentRuntimePromptBuilder(),
    screenshotLoader: AgentRuntimeScreenshotLoader = AgentRuntimeScreenshotLoader()
  ) {
    self.actionValidator = actionValidator
    self.engine = engine
    self.promptBuilder = promptBuilder
    self.screenshotLoader = screenshotLoader
  }

  func runInference(requestDictionary: [String: Any]) -> [String: Any] {
    do {
      let request = try AgentRuntimeRequest(dictionary: requestDictionary)
      let screenshot = try screenshotLoader.load(from: request.screenshotUrl)
      let prompt = promptBuilder.buildPrompt(for: request, screenshot: screenshot)
      let candidate = try engine.infer(
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
}
