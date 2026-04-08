package expo.modules.agentruntime

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AgentRuntimeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AgentRuntime")

    AsyncFunction("runInference") { request: Map<String, Any?> ->
      val goal = request["goal"] as? String ?: ""
      val screenshotUri = request["screenshotUri"] as? String ?: ""
      val axSnapshot = request["axSnapshot"] as? List<*> ?: emptyList<Any>()
      val actionHistory = request["actionHistory"] as? List<*> ?: emptyList<Any>()
      val sessionPlan = request["sessionPlan"] as? Map<*, *>
      val planningContext = request["planningContext"] as? Map<*, *>

      mapOf(
        "ok" to true,
        "action" to "finish",
        "parameters" to mapOf(
          "status" to "replay",
          "message" to "Native bridge ready for goal '$goal'. Screenshot: $screenshotUri. AX nodes: ${axSnapshot.size}. Prior actions: ${actionHistory.size}."
        ),
        "planUpdates" to null,
        "backend" to "android-stub",
        "diagnostics" to mapOf(
          "actionHistoryCount" to actionHistory.size,
          "planningContextReasons" to (planningContext?.get("reasons") ?: emptyList<String>()),
          "planningImageProvided" to (planningContext != null),
          "planPhase" to sessionPlan?.get("phase"),
          "screenshotUri" to screenshotUri
        )
      )
    }

    AsyncFunction("runLiteRTLMSmokeTest") { _: String ->
      mapOf(
        "ok" to false,
        "code" to "model_load_failed",
        "message" to "LiteRT-LM text smoke tests are unavailable on the Android stub.",
        "details" to null,
        "retryable" to false,
        "backend" to "android-stub"
      )
    }

    AsyncFunction("listAvailableModels") {
      emptyList<Map<String, Any?>>()
    }

    AsyncFunction("getModelStatus") {
      mapOf(
        "activeModelId" to null,
        "activeCommitHash" to null,
        "isDownloading" to false,
        "downloadedBytes" to 0,
        "totalBytes" to 0,
        "lastError" to "Model downloads are unavailable on the Android stub."
      )
    }

    AsyncFunction("downloadModel") { _: String ->
      mapOf(
        "activeModelId" to null,
        "activeCommitHash" to null,
        "isDownloading" to false,
        "downloadedBytes" to 0,
        "totalBytes" to 0,
        "lastError" to "Model downloads are unavailable on the Android stub."
      )
    }
  }
}
