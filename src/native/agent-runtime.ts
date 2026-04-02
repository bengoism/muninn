import AgentRuntimeModule from '../../modules/agent-runtime';
import type { InferenceRequest, InferenceResponse } from '../types/agent';

export async function runInference(
  request: InferenceRequest
): Promise<InferenceResponse> {
  return AgentRuntimeModule.runInference(request);
}
