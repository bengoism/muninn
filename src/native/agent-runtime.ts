import AgentRuntimeModule from '../../modules/agent-runtime';
import type {
  InferenceRequest,
  InferenceResponse,
  ModelCatalogEntry,
  ModelStatus,
} from '../types/agent';

export async function runInference(
  request: InferenceRequest
): Promise<InferenceResponse> {
  return AgentRuntimeModule.runInference(request);
}

export async function listAvailableModels(): Promise<ModelCatalogEntry[]> {
  return AgentRuntimeModule.listAvailableModels();
}

export async function getModelStatus(): Promise<ModelStatus> {
  return AgentRuntimeModule.getModelStatus();
}

export async function downloadModel(modelId: string): Promise<ModelStatus> {
  return AgentRuntimeModule.downloadModel(modelId);
}
