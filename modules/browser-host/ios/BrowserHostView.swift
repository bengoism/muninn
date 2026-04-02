import ExpoModulesCore
import UIKit
import WebKit

class BrowserHostView: ExpoView, WKNavigationDelegate {
  static let telemetryHandlerName = "muninnBrowserHostTelemetry"

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
        promise.resolve([
          "code": "capture_unavailable",
          "details": NSNull(),
          "message": "Browser host view is no longer mounted.",
          "ok": false
        ])
        return
      }

      guard !self.webView.bounds.isEmpty else {
        promise.resolve([
          "code": "capture_unavailable",
          "details": NSNull(),
          "message": "Browser viewport has no visible bounds.",
          "ok": false
        ])
        return
      }

      let configuration = WKSnapshotConfiguration()
      configuration.rect = self.webView.bounds
      configuration.afterScreenUpdates = true

      self.webView.takeSnapshot(with: configuration) { image, error in
        if let error = error as NSError? {
          promise.resolve([
            "code": "capture_failed",
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

        guard let image else {
          promise.resolve([
            "code": "capture_failed",
            "details": NSNull(),
            "message": "Viewport capture returned no image.",
            "ok": false
          ])
          return
        }

        guard let imageData = image.pngData() else {
          promise.resolve([
            "code": "write_failed",
            "details": NSNull(),
            "message": "Viewport capture could not be encoded as PNG.",
            "ok": false
          ])
          return
        }

        let captureUrl = URL(fileURLWithPath: NSTemporaryDirectory())
          .appendingPathComponent("muninn-viewport-\(UUID().uuidString).png")

        do {
          try imageData.write(to: captureUrl, options: [.atomic])
        } catch {
          let resolvedError = error as NSError

          promise.resolve([
            "code": "write_failed",
            "details": [
              "code": resolvedError.code,
              "domain": resolvedError.domain,
              "message": resolvedError.localizedDescription
            ],
            "message": resolvedError.localizedDescription,
            "ok": false
          ])
          return
        }

        let pointSize = self.webView.bounds.size
        let scale = self.webView.window?.screen.scale ?? UIScreen.main.scale
        let interfaceOrientation = self.webView.window?.windowScene?.interfaceOrientation
        let orientation = interfaceOrientation?.isLandscape == true ? "landscape" : "portrait"

        promise.resolve([
          "capture": [
            "capturedAt": ISO8601DateFormatter().string(from: Date()),
            "height": Int(round(pointSize.height * scale)),
            "orientation": orientation,
            "pointHeight": pointSize.height,
            "pointWidth": pointSize.width,
            "scale": scale,
            "uri": captureUrl.absoluteString,
            "width": Int(round(pointSize.width * scale))
          ],
          "ok": true
        ])
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
