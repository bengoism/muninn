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

      mapOf(
        "ok" to true,
        "action" to "finish",
        "parameters" to mapOf(
          "status" to "replay",
          "message" to "Native bridge ready for goal '$goal'. Screenshot: $screenshotUri. AX nodes: ${axSnapshot.size}. Prior actions: ${actionHistory.size}."
        ),
        "backend" to "android-stub",
        "diagnostics" to mapOf(
          "actionHistoryCount" to actionHistory.size,
          "screenshotUri" to screenshotUri
        )
      )
    }
  }
}
