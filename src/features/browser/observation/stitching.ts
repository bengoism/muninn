import type {
  AxNode,
  ObservationFrameSnapshot,
  Point,
} from '../../../types/agent';
import type {
  BrowserAxSnapshotErrorMessage,
  BrowserAxSnapshotMessage,
  BrowserFrameLinkPayload,
} from '../types';

type StitchObservationInput = {
  errors: BrowserAxSnapshotErrorMessage[];
  expectedFrameIds: string[];
  frameLinks: Map<string, BrowserFrameLinkPayload>;
  responses: BrowserAxSnapshotMessage[];
  timedOut: boolean;
};

type StitchObservationOutput = {
  axSnapshot: AxNode[];
  frameSnapshots: ObservationFrameSnapshot[];
  warnings: string[];
};

export function stitchObservationArtifacts(
  input: StitchObservationInput
): StitchObservationOutput {
  const warnings: string[] = [];
  const topFrameIds = new Set(
    input.responses
      .filter((response) => response.frame.isTopFrame)
      .map((response) => response.frame.frameId)
  );
  const responsesByFrameId = new Map(
    input.responses.map((response) => [response.frame.frameId, response] as const)
  );
  const errorsByFrameId = new Map(
    input.errors.map((error) => [error.frame.frameId, error] as const)
  );
  input.errors.forEach((error) => {
    if (error.frame.isTopFrame) {
      topFrameIds.add(error.frame.frameId);
    }
  });
  const frameIds = new Set<string>([
    ...input.expectedFrameIds,
    ...responsesByFrameId.keys(),
    ...errorsByFrameId.keys(),
    ...input.frameLinks.keys(),
  ]);
  const rootFrameIds = new Set(topFrameIds);
  const linkedChildFrameIds = new Set(input.frameLinks.keys());

  input.frameLinks.forEach((link) => {
    if (!linkedChildFrameIds.has(link.parentFrameId)) {
      rootFrameIds.add(link.parentFrameId);
    }
  });

  if (rootFrameIds.size === 0 && frameIds.size === 1) {
    const [onlyFrameId] = Array.from(frameIds);

    if (onlyFrameId) {
      rootFrameIds.add(onlyFrameId);
    }
  }

  const originCache = new Map<string, Point | null>();

  const frameSnapshots = Array.from(frameIds)
    .sort()
    .map((frameId) => {
      const response = responsesByFrameId.get(frameId) ?? null;
      const error = errorsByFrameId.get(frameId) ?? null;
      const link = input.frameLinks.get(frameId) ?? null;
      const frameOrigin = resolveFrameOrigin(
        frameId,
        input.frameLinks,
        rootFrameIds,
        originCache,
        warnings
      );

      if (!response && !error) {
        warnings.push(`Missing AX snapshot response for frame "${frameId}".`);
      }

      return {
        error: error?.payload.message ?? null,
        frameBounds: link?.bounds ?? null,
        frameId,
        frameOrigin,
        frameTitle: response?.frame.title ?? error?.frame.title ?? null,
        frameUrl: response?.frame.url ?? error?.frame.url ?? null,
        nodeCount: response?.payload.nodes.length ?? 0,
        observedAt: response?.payload.observedAt ?? error?.timestamp ?? null,
        parentFrameId: link?.parentFrameId ?? null,
        timedOut: input.timedOut && !response,
      } satisfies ObservationFrameSnapshot;
    });

  const axSnapshot = input.responses.flatMap((response) => {
    const frameOrigin =
      resolveFrameOrigin(
        response.frame.frameId,
        input.frameLinks,
        rootFrameIds,
        originCache,
        warnings
      );

    if (!frameOrigin) {
      warnings.push(
        `Skipped AX snapshot nodes for frame "${response.frame.frameId}" because its viewport origin could not be resolved.`
      );
      return [];
    }

    return response.payload.nodes.map((node) => ({
      bounds: {
        height: node.bounds.height,
        width: node.bounds.width,
        x: round(node.bounds.x + frameOrigin.x),
        y: round(node.bounds.y + frameOrigin.y),
      },
      frameId: node.frameId ?? response.frame.frameId,
      frameOrigin,
      frameUrl: node.frameUrl ?? response.frame.url,
      id: node.id,
      isEnabled: node.isEnabled,
      isHidden: node.isHidden,
      isVisible: node.isVisible,
      label: node.label,
      placeholder: node.placeholder,
      redactionReason: node.redactionReason,
      role: node.role,
      text: node.text,
      value: node.value,
      valueRedacted: node.valueRedacted,
    }) satisfies AxNode);
  });

  return {
    axSnapshot,
    frameSnapshots,
    warnings,
  };
}

function resolveFrameOrigin(
  frameId: string,
  frameLinks: Map<string, BrowserFrameLinkPayload>,
  rootFrameIds: Set<string>,
  cache: Map<string, Point | null>,
  warnings: string[],
  trail: Set<string> = new Set()
): Point | null {
  if (cache.has(frameId)) {
    return cache.get(frameId) ?? null;
  }

  if (trail.has(frameId)) {
    warnings.push(`Detected a cyclic frame link for "${frameId}".`);
    cache.set(frameId, null);
    return null;
  }

  const link = frameLinks.get(frameId);

  if (!link) {
    if (!rootFrameIds.has(frameId)) {
      warnings.push(`Missing frame link metadata for "${frameId}".`);
      cache.set(frameId, null);
      return null;
    }

    const rootOrigin = { x: 0, y: 0 };
    cache.set(frameId, rootOrigin);
    return rootOrigin;
  }

  trail.add(frameId);
  const parentOrigin = resolveFrameOrigin(
    link.parentFrameId,
    frameLinks,
    rootFrameIds,
    cache,
    warnings,
    trail
  );
  trail.delete(frameId);

  if (!parentOrigin) {
    cache.set(frameId, null);
    return null;
  }

  const resolvedOrigin = {
    x: round(parentOrigin.x + link.bounds.x),
    y: round(parentOrigin.y + link.bounds.y),
  };

  cache.set(frameId, resolvedOrigin);
  return resolvedOrigin;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
