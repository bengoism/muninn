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

    let resized = Self.normalizeForModel(image, maxDimension: Self.maxDimension)
    let encodedImage = Self.encodeForModel(resized)

    guard let imageData = encodedImage?.data else {
      throw AgentRuntimeFailure(
        code: .screenshotLoadFailed,
        message: "Could not encode resized screenshot for model inference.",
        details: [
          "path": url.path
        ],
        backend: "bridge"
      )
    }

    let resizedUrl = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent(
        "muninn-screenshot-resized-\(UUID().uuidString).\(encodedImage?.fileExtension ?? "jpg")"
      )

    try imageData.write(to: resizedUrl, options: [.atomic])

    let pixelWidth = Int(round(resized.size.width * resized.scale))
    let pixelHeight = Int(round(resized.size.height * resized.scale))

    return ScreenshotArtifact(
      url: resizedUrl,
      pixelWidth: pixelWidth,
      pixelHeight: pixelHeight
    )
  }

  private static func normalizeForModel(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
    let originalWidth = image.size.width
    let originalHeight = image.size.height
    let longestEdge = max(originalWidth, originalHeight)

    let targetSize: CGSize

    if longestEdge > maxDimension {
      let scale = maxDimension / longestEdge
      targetSize = CGSize(
        width: round(originalWidth * scale),
        height: round(originalHeight * scale)
      )
    } else {
      targetSize = CGSize(width: originalWidth, height: originalHeight)
    }

    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    format.opaque = true

    if #available(iOS 12.0, *) {
      format.preferredRange = .standard
    }

    let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)
    return renderer.image { _ in
      UIColor.white.setFill()
      UIRectFill(CGRect(origin: .zero, size: targetSize))
      image.draw(in: CGRect(origin: .zero, size: targetSize))
    }
  }

  private static func encodeForModel(_ image: UIImage) -> EncodedImage? {
    if let jpegData = image.jpegData(compressionQuality: Self.jpegQuality) {
      return EncodedImage(data: jpegData, fileExtension: "jpg")
    }

    if let pngData = image.pngData() {
      return EncodedImage(data: pngData, fileExtension: "png")
    }

    return nil
  }
}

private struct EncodedImage {
  let data: Data
  let fileExtension: String
}
