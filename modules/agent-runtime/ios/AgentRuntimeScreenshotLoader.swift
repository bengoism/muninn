import Foundation
import UIKit

final class AgentRuntimeScreenshotLoader {
  private static let maxDimension: CGFloat = 512
  private static let jpegQuality: CGFloat = 0.7

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

    let resized = Self.resize(image, maxDimension: Self.maxDimension)

    guard let jpegData = resized.jpegData(compressionQuality: Self.jpegQuality) else {
      throw AgentRuntimeFailure(
        code: .screenshotLoadFailed,
        message: "Could not encode resized screenshot as JPEG.",
        details: [
          "path": url.path
        ],
        backend: "bridge"
      )
    }

    let resizedUrl = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("muninn-screenshot-resized-\(UUID().uuidString).jpg")

    try jpegData.write(to: resizedUrl, options: [.atomic])

    let pixelWidth = Int(round(resized.size.width * resized.scale))
    let pixelHeight = Int(round(resized.size.height * resized.scale))

    return ScreenshotArtifact(
      url: resizedUrl,
      pixelWidth: pixelWidth,
      pixelHeight: pixelHeight
    )
  }

  private static func resize(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
    let originalWidth = image.size.width
    let originalHeight = image.size.height
    let longestEdge = max(originalWidth, originalHeight)

    guard longestEdge > maxDimension else {
      return image
    }

    let scale = maxDimension / longestEdge
    let newSize = CGSize(
      width: round(originalWidth * scale),
      height: round(originalHeight * scale)
    )

    let renderer = UIGraphicsImageRenderer(size: newSize)
    return renderer.image { _ in
      image.draw(in: CGRect(origin: .zero, size: newSize))
    }
  }
}
