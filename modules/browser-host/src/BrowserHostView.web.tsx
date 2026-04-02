import * as React from 'react';
import { View } from 'react-native';

import type { BrowserHostViewHandle, BrowserHostViewProps } from './BrowserHost.types';

const BrowserHostView = React.forwardRef<BrowserHostViewHandle, BrowserHostViewProps>(
  function BrowserHostView(props, ref) {
    React.useImperativeHandle(ref, () => ({
      captureViewport: async () => ({
        ok: false,
        code: 'capture_unavailable',
        message: 'Viewport capture is only implemented natively on iOS.',
      }),
      evaluateJavaScript: async () => ({
        ok: false,
        code: 'execution_error',
        message: 'BrowserHost is only implemented natively on iOS.',
      }),
      goBack: async () => null,
      goForward: async () => null,
      nativeTag: null,
      reload: async () => null,
      stopLoading: async () => null,
    }));

    return <View style={props.style} />;
  }
);

export default BrowserHostView;
