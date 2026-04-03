import Foundation
import UIKit

final class AgentRuntimeScreenshotLoader {
  func load(from url: URL) throws -> ScreenshotArtifact {
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw AgentRuntimeFailure(
        code: .screenshotNotFound,
        message: "The screenshot file could not be found on disk.",
        details: [
          "path": url.path
        ],
        backend: "bridge"
      )
    }

    guard let image = UIImage(contentsOfFile: url.path) else {
      throw AgentRuntimeFailure(
        code: .screenshotLoadFailed,
        message: "The screenshot file could not be decoded as an image.",
        details: [
          "path": url.path
        ],
        backend: "bridge"
      )
    }

    let pixelWidth = Int(round(image.size.width * image.scale))
    let pixelHeight = Int(round(image.size.height * image.scale))

    return ScreenshotArtifact(
      url: url,
      pixelWidth: pixelWidth,
      pixelHeight: pixelHeight
    )
  }
}
