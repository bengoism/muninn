import ExpoModulesCore

public class BrowserHostModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BrowserHost")

    View(BrowserHostView.self) {
      Prop("sourceUrl") { (view: BrowserHostView, sourceUrl: String?) in
        view.sourceUrl = sourceUrl
      }

      Prop("sourceHtml") { (view: BrowserHostView, sourceHtml: String?) in
        view.sourceHtml = sourceHtml
      }

      Prop("sourceBaseUrl") { (view: BrowserHostView, sourceBaseUrl: String?) in
        view.sourceBaseUrl = sourceBaseUrl
      }

      Prop("bootstrapScript") { (view: BrowserHostView, bootstrapScript: String?) in
        view.bootstrapScript = bootstrapScript
      }

      Prop("afterContentScript") { (view: BrowserHostView, afterContentScript: String?) in
        view.afterContentScript = afterContentScript
      }

      OnViewDidUpdateProps { view in
        view.syncInjectedScriptsIfNeeded()
        view.applySourceIfNeeded()
      }

      Events(
        "onLoadStart",
        "onLoadProgress",
        "onNavigationStateChange",
        "onNavigationError",
        "onTelemetryMessage"
      )

      AsyncFunction("evaluateJavaScript") { (view: BrowserHostView, source: String, promise: Promise) in
        view.evaluateJavaScript(source, promise: promise)
      }

      AsyncFunction("captureViewport") { (view: BrowserHostView, promise: Promise) in
        view.captureViewport(promise: promise)
      }

      AsyncFunction("goBack") { (view: BrowserHostView) -> NSNull in
        view.goBack()
        return NSNull()
      }

      AsyncFunction("goForward") { (view: BrowserHostView) -> NSNull in
        view.goForward()
        return NSNull()
      }

      AsyncFunction("reload") { (view: BrowserHostView) -> NSNull in
        view.reload()
        return NSNull()
      }

      AsyncFunction("stopLoading") { (view: BrowserHostView) -> NSNull in
        view.stopLoading()
        return NSNull()
      }
    }
  }
}
