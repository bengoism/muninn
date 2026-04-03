import Foundation

final class AgentRuntimeModelManager: NSObject, @unchecked Sendable {
  private struct ActiveDownload {
    let model: AgentRuntimeAllowlistedModel
    let taskIdentifier: Int
    var downloadedBytes: Int64
    var totalBytes: Int64
  }

  private let allowlistedModels = [AgentRuntimeAllowlistedModel.gemma4E2B]
  private let decoder = JSONDecoder()
  private let encoder = JSONEncoder()
  private let fileManager: FileManager
  private let syncQueue = DispatchQueue(label: "AgentRuntimeModelManager.sync")

  private var activeDownload: ActiveDownload?
  private var completedTaskIdentifiers = Set<Int>()
  private var lastError: String?

  private lazy var session: URLSession = {
    let configuration = URLSessionConfiguration.default
    configuration.waitsForConnectivity = true
    return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
  }()

  init(fileManager: FileManager = .default) {
    self.fileManager = fileManager
    self.encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    super.init()
  }

  func listAvailableModels() -> [[String: Any]] {
    syncQueue.sync {
      let state = loadState()

      return allowlistedModels.map { model in
        let downloaded = installationIfPresent(for: model) != nil
        let active =
          downloaded &&
          state.activeModelId == model.id &&
          state.activeCommitHash == model.commitHash

        return model.asCatalogEntry(downloaded: downloaded, active: active).asDictionary()
      }
    }
  }

  func getModelStatus() -> [String: Any] {
    syncQueue.sync {
      currentStatus().asDictionary()
    }
  }

  func downloadModel(modelId: String) -> [String: Any] {
    var taskToStart: URLSessionDownloadTask?

    let status = syncQueue.sync { () -> AgentRuntimeModelStatus in
      lastError = nil

      guard let model = allowlistedModels.first(where: { $0.id == modelId }) else {
        lastError = "Unknown model '\(modelId)'."
        return currentStatus()
      }

      if activeDownload != nil {
        lastError = "A model download is already in progress."
        return currentStatus()
      }

      if installationIfPresent(for: model) != nil {
        do {
          try activate(model)
        } catch {
          lastError = "Could not activate the downloaded model: \(error.localizedDescription)"
        }

        return currentStatus()
      }

      do {
        try ensureModelsRootDirectory()
      } catch {
        lastError = "Could not create model storage: \(error.localizedDescription)"
        return currentStatus()
      }

      let task = session.downloadTask(with: model.downloadUrl)
      activeDownload = ActiveDownload(
        model: model,
        taskIdentifier: task.taskIdentifier,
        downloadedBytes: 0,
        totalBytes: model.approximateSizeBytes
      )
      taskToStart = task

      return currentStatus()
    }

    taskToStart?.resume()
    return status.asDictionary()
  }

  func requireActiveInstallation() throws -> AgentRuntimeModelInstallation {
    try syncQueue.sync {
      let state = loadState()

      guard
        let activeModelId = state.activeModelId,
        let activeCommitHash = state.activeCommitHash
      else {
        throw AgentRuntimeFailure(
          code: .modelNotConfigured,
          message: "No downloaded LiteRT-LM model is active on this device.",
          backend: "model-manager"
        )
      }

      guard
        let model = allowlistedModels.first(where: {
          $0.id == activeModelId && $0.commitHash == activeCommitHash
        }),
        let installation = installationIfPresent(for: model)
      else {
        throw AgentRuntimeFailure(
          code: .modelNotConfigured,
          message: "The active LiteRT-LM model could not be found on disk.",
          details: [
            "activeModelId": activeModelId,
            "activeCommitHash": activeCommitHash
          ],
          backend: "model-manager"
        )
      }

      return installation
    }
  }

  private func currentStatus() -> AgentRuntimeModelStatus {
    let state = loadState()

    let activeInstallation =
      allowlistedModels
      .first(where: { model in
        model.id == state.activeModelId && model.commitHash == state.activeCommitHash
      })
      .flatMap { installationIfPresent(for: $0) }

    return AgentRuntimeModelStatus(
      activeModelId: activeInstallation?.model.id,
      activeCommitHash: activeInstallation?.model.commitHash,
      isDownloading: activeDownload != nil,
      downloadedBytes: activeDownload?.downloadedBytes ?? 0,
      totalBytes: activeDownload?.totalBytes ?? 0,
      lastError: lastError
    )
  }

  private func ensureModelsRootDirectory() throws {
    try fileManager.createDirectory(
      at: modelsRootURL(),
      withIntermediateDirectories: true,
      attributes: nil
    )
  }

  private func modelsRootURL() -> URL {
    fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Models", isDirectory: true)
  }

  private func stateURL() -> URL {
    modelsRootURL().appendingPathComponent("state.json")
  }

  private func installationDirectoryURL(for model: AgentRuntimeAllowlistedModel) -> URL {
    modelsRootURL()
      .appendingPathComponent(model.sanitizedModelId, isDirectory: true)
      .appendingPathComponent(model.commitHash, isDirectory: true)
  }

  private func modelFileURL(for model: AgentRuntimeAllowlistedModel) -> URL {
    installationDirectoryURL(for: model).appendingPathComponent(model.filename)
  }

  private func metadataURL(for model: AgentRuntimeAllowlistedModel) -> URL {
    installationDirectoryURL(for: model).appendingPathComponent("metadata.json")
  }

  private func loadState() -> AgentRuntimeModelState {
    let url = stateURL()

    guard let data = try? Data(contentsOf: url) else {
      return AgentRuntimeModelState()
    }

    return (try? decoder.decode(AgentRuntimeModelState.self, from: data)) ?? AgentRuntimeModelState()
  }

  private func saveState(_ state: AgentRuntimeModelState) throws {
    try ensureModelsRootDirectory()
    let data = try encoder.encode(state)
    try data.write(to: stateURL(), options: .atomic)
  }

  private func activate(_ model: AgentRuntimeAllowlistedModel) throws {
    try saveState(
      AgentRuntimeModelState(
        activeModelId: model.id,
        activeCommitHash: model.commitHash
      )
    )
  }

  private func installationIfPresent(
    for model: AgentRuntimeAllowlistedModel
  ) -> AgentRuntimeModelInstallation? {
    let installDirectoryURL = installationDirectoryURL(for: model)
    let modelFileURL = modelFileURL(for: model)
    let metadataURL = metadataURL(for: model)

    guard
      fileManager.fileExists(atPath: installDirectoryURL.path),
      fileManager.fileExists(atPath: modelFileURL.path),
      fileManager.fileExists(atPath: metadataURL.path)
    else {
      return nil
    }

    return AgentRuntimeModelInstallation(
      model: model,
      installDirectoryURL: installDirectoryURL,
      modelFileURL: modelFileURL,
      metadataURL: metadataURL
    )
  }

  private func persistMetadata(for model: AgentRuntimeAllowlistedModel, installedBytes: Int64) throws {
    let metadata = AgentRuntimeInstallMetadata(
      id: model.id,
      displayName: model.displayName,
      modelId: model.modelId,
      commitHash: model.commitHash,
      filename: model.filename,
      approximateSizeBytes: model.approximateSizeBytes,
      installedBytes: installedBytes,
      installedAt: ISO8601DateFormatter().string(from: Date())
    )

    let data = try encoder.encode(metadata)
    try data.write(to: metadataURL(for: model), options: .atomic)
  }

  private func finalizeDownload(
    for model: AgentRuntimeAllowlistedModel,
    temporaryLocation: URL
  ) throws {
    let installDirectoryURL = installationDirectoryURL(for: model)
    let modelFileURL = modelFileURL(for: model)

    if fileManager.fileExists(atPath: installDirectoryURL.path) {
      try fileManager.removeItem(at: installDirectoryURL)
    }

    try fileManager.createDirectory(
      at: installDirectoryURL,
      withIntermediateDirectories: true,
      attributes: nil
    )

    try fileManager.moveItem(at: temporaryLocation, to: modelFileURL)

    let attributes = try fileManager.attributesOfItem(atPath: modelFileURL.path)
    let installedBytes = (attributes[.size] as? NSNumber)?.int64Value ?? -1

    guard installedBytes == model.approximateSizeBytes else {
      try? fileManager.removeItem(at: modelFileURL)
      throw NSError(
        domain: "AgentRuntimeModelManager",
        code: 2,
        userInfo: [
          NSLocalizedDescriptionKey:
            "Downloaded model size did not match the pinned allowlist entry.",
          "expectedBytes": NSNumber(value: model.approximateSizeBytes),
          "installedBytes": NSNumber(value: installedBytes)
        ]
      )
    }

    try persistMetadata(for: model, installedBytes: installedBytes)
    try activate(model)
  }
}

extension AgentRuntimeModelManager: URLSessionDownloadDelegate {
  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64,
    totalBytesExpectedToWrite: Int64
  ) {
    syncQueue.sync {
      guard var activeDownload, activeDownload.taskIdentifier == downloadTask.taskIdentifier else {
        return
      }

      activeDownload.downloadedBytes = totalBytesWritten

      if totalBytesExpectedToWrite > 0 {
        activeDownload.totalBytes = totalBytesExpectedToWrite
      }

      self.activeDownload = activeDownload
    }
  }

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {
    syncQueue.sync {
      guard let activeDownload, activeDownload.taskIdentifier == downloadTask.taskIdentifier else {
        return
      }

      do {
        try finalizeDownload(for: activeDownload.model, temporaryLocation: location)
        completedTaskIdentifiers.insert(downloadTask.taskIdentifier)
        self.activeDownload = nil
        lastError = nil
      } catch {
        self.activeDownload = nil
        lastError = "Model download failed: \(error.localizedDescription)"
      }
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    syncQueue.sync {
      if completedTaskIdentifiers.remove(task.taskIdentifier) != nil {
        return
      }

      guard
        let activeDownload,
        activeDownload.taskIdentifier == task.taskIdentifier,
        let error
      else {
        return
      }

      self.activeDownload = nil
      lastError = "Model download failed: \(error.localizedDescription)"
    }
  }
}
