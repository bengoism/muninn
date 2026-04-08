import ExpoModulesCore
import UIKit
import WebKit

class BrowserHostView: ExpoView, WKNavigationDelegate, WKUIDelegate {
  static let telemetryHandlerName = "muninnBrowserHostTelemetry"
  private static let fullPageMaxOutputWidth: CGFloat = 1280
  private static let fullPageMaxOutputHeight: CGFloat = 4096
  private static let fullPageMaxTileCount: Int = 12
  private static let fullPagePreferredTileHeight: CGFloat = 1400

  private lazy var telemetryMessageHandler = BrowserHostScriptMessageHandler(owner: self)
  private let onLoadProgress = EventDispatcher()
  private let onLoadStart = EventDispatcher()
  private let onNavigationError = EventDispatcher()
  private let onNavigationStateChange = EventDispatcher()
  private let onTelemetryMessage = EventDispatcher()
  private let webView: WKWebView

  private var lastAppliedScriptSignature: String?
  private var lastAppliedSourceSignature: String?
  private var progressObservation: NSKeyValueObservation?

  var afterContentScript: String?
  var bootstrapScript: String?
  var sourceBaseUrl: String?
  var sourceHtml: String?
  var sourceUrl: String?

  required init(appContext: AppContext? = nil) {
    let configuration = WKWebViewConfiguration()
    configuration.userContentController = WKUserContentController()

    webView = WKWebView(frame: .zero, configuration: configuration)

    super.init(appContext: appContext)

    clipsToBounds = true
    webView.allowsBackForwardNavigationGestures = true
    webView.navigationDelegate = self
    webView.uiDelegate = self

    addSubview(webView)

    resetInjectedScripts()

    progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] webView, _ in
      self?.onLoadProgress([
        "progress": webView.estimatedProgress
      ])
      self?.emitNavigationState()
    }
  }

  deinit {
    progressObservation?.invalidate()
    webView.configuration.userContentController.removeScriptMessageHandler(forName: Self.telemetryHandlerName)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    webView.frame = bounds
  }

  func syncInjectedScriptsIfNeeded() {
    let signature = [bootstrapScript ?? "", afterContentScript ?? ""].joined(separator: "\u{1F}")

    guard signature != lastAppliedScriptSignature else {
      return
    }

    lastAppliedScriptSignature = signature
    resetInjectedScripts()
  }

  func applySourceIfNeeded() {
    let signature = [sourceUrl ?? "", sourceHtml ?? "", sourceBaseUrl ?? ""].joined(separator: "\u{1F}")

    guard signature != lastAppliedSourceSignature else {
      return
    }

    lastAppliedSourceSignature = signature

    if let sourceHtml, !sourceHtml.isEmpty {
      let baseUrl = sourceBaseUrl.flatMap(URL.init(string:))
      webView.loadHTMLString(sourceHtml, baseURL: baseUrl)
      return
    }

    guard let sourceUrl, !sourceUrl.isEmpty else {
      return
    }

    guard let url = URL(string: sourceUrl) else {
      onNavigationError([
        "description": "Invalid browser URL.",
        "type": "navigation_error",
        "url": sourceUrl
      ])
      return
    }

    webView.load(URLRequest(url: url))
  }

  func evaluateJavaScript(_ source: String, promise: Promise) {
    let evaluateBlock = { [weak self] in
      guard let self else {
        promise.resolve([
          "code": "execution_error",
          "details": NSNull(),
          "message": "Browser host view is no longer mounted.",
          "ok": false
        ])
        return
      }

      self.webView.evaluateJavaScript(source) { value, error in
        if let error = error as NSError? {
          promise.resolve([
            "code": "execution_error",
            "details": [
              "code": error.code,
              "domain": error.domain,
              "message": error.localizedDescription
            ],
            "message": error.localizedDescription,
            "ok": false
          ])
          return
        }

        promise.resolve([
          "ok": true,
          "value": BrowserHostView.serializeJavaScriptValue(value)
        ])
      }
    }

    if Thread.isMainThread {
      evaluateBlock()
    } else {
      DispatchQueue.main.async(execute: evaluateBlock)
    }
  }

  func captureViewport(promise: Promise) {
    let captureBlock = { [weak self] in
      guard let self else {
        promise.resolve(self?.captureFailurePayload(
          code: "capture_unavailable",
          message: "Browser host view is no longer mounted."
        ) ?? [
          "code": "capture_unavailable",
          "details": NSNull(),
          "message": "Browser host view is no longer mounted.",
          "ok": false
        ])
        return
      }

      guard !self.webView.bounds.isEmpty else {
        promise.resolve(
          self.captureFailurePayload(
            code: "capture_unavailable",
            message: "Browser viewport has no visible bounds."
          )
        )
        return
      }

      let configuration = WKSnapshotConfiguration()
      configuration.rect = self.webView.bounds
      configuration.afterScreenUpdates = true

      self.webView.takeSnapshot(with: configuration) { image, error in
        if let error = error as NSError? {
          promise.resolve(
            self.captureFailurePayload(
              code: "capture_failed",
              message: error.localizedDescription,
              details: self.errorDetails(error)
            )
          )
          return
        }

        guard let image else {
          promise.resolve(
            self.captureFailurePayload(
              code: "capture_failed",
              message: "Viewport capture returned no image."
            )
          )
          return
        }

        do {
          let payload = try self.persistCapture(
            image: image,
            pointSize: self.webView.bounds.size,
            scale: self.webView.window?.screen.scale ?? UIScreen.main.scale,
            filePrefix: "muninn-viewport"
          )

          promise.resolve([
            "capture": payload,
            "ok": true
          ])
        } catch {
          let resolvedError = error as NSError
          promise.resolve(
            self.captureFailurePayload(
              code: "write_failed",
              message: resolvedError.localizedDescription,
              details: self.errorDetails(resolvedError)
            )
          )
        }
      }
    }

    if Thread.isMainThread {
      captureBlock()
    } else {
      DispatchQueue.main.async(execute: captureBlock)
    }
  }

  func captureFullPage(promise: Promise) {
    let captureBlock = { [weak self] in
      guard let self else {
        promise.resolve([
          "code": "capture_unavailable",
          "details": NSNull(),
          "message": "Browser host view is no longer mounted.",
          "ok": false
        ])
        return
      }

      guard !self.webView.bounds.isEmpty else {
        promise.resolve(
          self.captureFailurePayload(
            code: "capture_unavailable",
            message: "Browser viewport has no visible bounds."
          )
        )
        return
      }

      let viewportSize = self.webView.bounds.size
      let contentSize = self.webView.scrollView.contentSize
      let pageSize = CGSize(
        width: max(contentSize.width, viewportSize.width),
        height: max(contentSize.height, viewportSize.height)
      )

      guard pageSize.width > 0, pageSize.height > 0 else {
        promise.resolve(
          self.captureFailurePayload(
            code: "capture_unavailable",
            message: "Browser page has no measurable content size."
          )
        )
        return
      }

      let renderScale = min(
        1,
        Self.fullPageMaxOutputWidth / max(pageSize.width, 1),
        Self.fullPageMaxOutputHeight / max(pageSize.height, 1)
      )
      let outputSize = CGSize(
        width: max(1, floor(pageSize.width * renderScale)),
        height: max(1, floor(pageSize.height * renderScale))
      )
      let tileCount = max(
        1,
        min(
          Self.fullPageMaxTileCount,
          Int(ceil(pageSize.height / Self.fullPagePreferredTileHeight))
        )
      )
      let tileRects = self.fullPageTileRects(pageSize: pageSize, tileCount: tileCount)

      self.captureFullPageTiles(
        tileRects: tileRects,
        outputWidth: outputSize.width
      ) { images, failurePayload in
        if let failurePayload {
          promise.resolve(failurePayload)
          return
        }

        guard let images else {
          promise.resolve(
            self.captureFailurePayload(
              code: "capture_failed",
              message: "Full-page capture returned no tiles."
            )
          )
          return
        }

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true

        if #available(iOS 12.0, *) {
          format.preferredRange = .standard
        }

        let stitched = UIGraphicsImageRenderer(size: outputSize, format: format).image { context in
          UIColor.white.setFill()
          context.cgContext.fill(CGRect(origin: .zero, size: outputSize))

          for (index, tileImage) in images.enumerated() {
            let tileRect = tileRects[index]
            let originY = floor(tileRect.origin.y * renderScale)
            let expectedHeight =
              index == images.count - 1
                ? max(1, outputSize.height - originY)
                : max(1, round(tileRect.height * renderScale))

            tileImage.draw(
              in: CGRect(
                x: 0,
                y: originY,
                width: outputSize.width,
                height: expectedHeight
              )
            )
          }
        }

        do {
          let payload = try self.persistCapture(
            image: stitched,
            pointSize: pageSize,
            scale: renderScale,
            filePrefix: "muninn-fullpage",
            extra: [
              "tileCount": tileCount,
              "viewportOriginX": self.webView.scrollView.contentOffset.x,
              "viewportOriginY": self.webView.scrollView.contentOffset.y,
              "viewportPointWidth": viewportSize.width,
              "viewportPointHeight": viewportSize.height
            ]
          )

          promise.resolve([
            "capture": payload,
            "ok": true
          ])
        } catch {
          let resolvedError = error as NSError
          promise.resolve(
            self.captureFailurePayload(
              code: "write_failed",
              message: resolvedError.localizedDescription,
              details: self.errorDetails(resolvedError)
            )
          )
        }
      }
    }

    if Thread.isMainThread {
      captureBlock()
    } else {
      DispatchQueue.main.async(execute: captureBlock)
    }
  }

  func goBack() {
    runOnMain {
      self.webView.goBack()
    }
  }

  func goForward() {
    runOnMain {
      self.webView.goForward()
    }
  }

  func reload() {
    runOnMain {
      self.webView.reload()
    }
  }

  func stopLoading() {
    runOnMain {
      self.webView.stopLoading()
    }
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation _: WKNavigation!) {
    onLoadStart([
      "url": currentUrl()
    ])
    emitNavigationState()
  }

  func webView(_ webView: WKWebView, didCommit _: WKNavigation!) {
    emitNavigationState()
  }

  func webView(_ webView: WKWebView, didFinish _: WKNavigation!) {
    emitNavigationState()
  }

  func webView(_ webView: WKWebView, didFail _: WKNavigation!, withError error: Error) {
    emitNavigationError(error, fallbackUrl: currentUrl())
    emitNavigationState()
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation _: WKNavigation!, withError error: Error) {
    emitNavigationError(error, fallbackUrl: currentUrl())
    emitNavigationState()
  }

  // MARK: - WKUIDelegate (auto-dismiss JS dialogs)

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    completionHandler()
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    completionHandler(true)
  }

  func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
    completionHandler(defaultText)
  }

  func userContentController(_: WKUserContentController, didReceive message: WKScriptMessage) {
    let data = BrowserHostView.stringifyScriptMessageBody(message.body)
    onTelemetryMessage([
      "data": data
    ])
  }

  private func runOnMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread {
      block()
    } else {
      DispatchQueue.main.async(execute: block)
    }
  }

  private func resetInjectedScripts() {
    let controller = webView.configuration.userContentController
    controller.removeAllUserScripts()
    controller.removeScriptMessageHandler(forName: Self.telemetryHandlerName)
    controller.add(telemetryMessageHandler, name: Self.telemetryHandlerName)

    if let bootstrapScript, !bootstrapScript.isEmpty {
      controller.addUserScript(
        WKUserScript(
          source: bootstrapScript,
          injectionTime: .atDocumentStart,
          forMainFrameOnly: false
        )
      )
    }

    if let afterContentScript, !afterContentScript.isEmpty {
      controller.addUserScript(
        WKUserScript(
          source: afterContentScript,
          injectionTime: .atDocumentEnd,
          forMainFrameOnly: false
        )
      )
    }
  }

  private func emitNavigationState() {
    onNavigationStateChange([
      "canGoBack": webView.canGoBack,
      "canGoForward": webView.canGoForward,
      "isLoading": webView.isLoading,
      "title": webView.title ?? "",
      "url": currentUrl()
    ])
  }

  private func emitNavigationError(_ error: Error, fallbackUrl: String) {
    let resolvedError = error as NSError

    onNavigationError([
      "code": resolvedError.code,
      "description": resolvedError.localizedDescription,
      "type": "navigation_error",
      "url": fallbackUrl
    ])
  }

  private func currentUrl() -> String {
    if let absoluteString = webView.url?.absoluteString {
      return absoluteString
    }
    if let sourceUrl {
      return sourceUrl
    }
    if let sourceBaseUrl {
      return sourceBaseUrl
    }
    return ""
  }

  private func persistCapture(
    image: UIImage,
    pointSize: CGSize,
    scale: CGFloat,
    filePrefix: String,
    extra: [String: Any] = [:]
  ) throws -> [String: Any] {
    guard let imageData = image.pngData() else {
      throw NSError(
        domain: "BrowserHostCapture",
        code: 1,
        userInfo: [
          NSLocalizedDescriptionKey: "Capture could not be encoded as PNG."
        ]
      )
    }

    let captureUrl = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("\(filePrefix)-\(UUID().uuidString).png")

    try imageData.write(to: captureUrl, options: [.atomic])

    var payload: [String: Any] = [
      "capturedAt": ISO8601DateFormatter().string(from: Date()),
      "height": Int(round(pointSize.height * scale)),
      "orientation": currentOrientationString(),
      "pointHeight": pointSize.height,
      "pointWidth": pointSize.width,
      "scale": scale,
      "uri": captureUrl.absoluteString,
      "width": Int(round(pointSize.width * scale))
    ]

    for (key, value) in extra {
      payload[key] = value
    }

    return payload
  }

  private func currentOrientationString() -> String {
    let interfaceOrientation = webView.window?.windowScene?.interfaceOrientation
    return interfaceOrientation?.isLandscape == true ? "landscape" : "portrait"
  }

  private func errorDetails(_ error: NSError) -> [String: Any] {
    [
      "code": error.code,
      "domain": error.domain,
      "message": error.localizedDescription
    ]
  }

  private func captureFailurePayload(
    code: String,
    message: String,
    details: [String: Any]? = nil
  ) -> [String: Any] {
    [
      "code": code,
      "details": details ?? NSNull(),
      "message": message,
      "ok": false
    ]
  }

  private func fullPageTileRects(pageSize: CGSize, tileCount: Int) -> [CGRect] {
    let tileHeight = pageSize.height / CGFloat(tileCount)

    return (0..<tileCount).map { index in
      let originY = CGFloat(index) * tileHeight
      return CGRect(
        x: 0,
        y: originY,
        width: pageSize.width,
        height: min(tileHeight, pageSize.height - originY)
      ).integral
    }
  }

  private func captureFullPageTiles(
    tileRects: [CGRect],
    outputWidth: CGFloat,
    index: Int = 0,
    images: [UIImage] = [],
    completion: @escaping ([UIImage]?, [String: Any]?) -> Void
  ) {
    if index >= tileRects.count {
      completion(images, nil)
      return
    }

    let configuration = WKSnapshotConfiguration()
    configuration.rect = tileRects[index]
    configuration.afterScreenUpdates = true
    configuration.snapshotWidth = NSNumber(value: Double(outputWidth))

    webView.takeSnapshot(with: configuration) { image, error in
      if let error = error as NSError? {
        completion(
          nil,
          self.captureFailurePayload(
            code: "capture_failed",
            message: error.localizedDescription,
            details: self.errorDetails(error)
          )
        )
        return
      }

      guard let image else {
        completion(
          nil,
          self.captureFailurePayload(
            code: "capture_failed",
            message: "Full-page tile capture returned no image."
          )
        )
        return
      }

      var nextImages = images
      nextImages.append(image)
      self.captureFullPageTiles(
        tileRects: tileRects,
        outputWidth: outputWidth,
        index: index + 1,
        images: nextImages,
        completion: completion
      )
    }
  }

  private static func serializeJavaScriptValue(_ value: Any?) -> Any {
    guard let value else {
      return [
        "type": "undefined"
      ]
    }

    if value is NSNull || value is NSString || value is NSNumber {
      return value
    }

    if let array = value as? [Any] {
      return array.map { serializeJavaScriptValue($0) }
    }

    if let dictionary = value as? [String: Any] {
      return dictionary.mapValues { serializeJavaScriptValue($0) }
    }

    if let dictionary = value as? NSDictionary {
      var serializedDictionary: [String: Any] = [:]

      for (key, dictionaryValue) in dictionary {
        serializedDictionary[String(describing: key)] = serializeJavaScriptValue(dictionaryValue)
      }

      return serializedDictionary
    }

    return [
      "type": "string",
      "value": String(describing: value)
    ]
  }

  private static func stringifyScriptMessageBody(_ body: Any) -> String {
    if let string = body as? String {
      return string
    }

    if JSONSerialization.isValidJSONObject(body),
       let data = try? JSONSerialization.data(withJSONObject: body),
       let jsonString = String(data: data, encoding: .utf8) {
      return jsonString
    }

    return String(describing: body)
  }
}

private final class BrowserHostScriptMessageHandler: NSObject, WKScriptMessageHandler {
  weak var owner: BrowserHostView?

  init(owner: BrowserHostView) {
    self.owner = owner
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    owner?.userContentController(userContentController, didReceive: message)
  }
}
