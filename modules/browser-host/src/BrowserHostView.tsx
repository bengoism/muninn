import { requireNativeView } from 'expo';
import * as React from 'react';

import type { BrowserHostViewHandle, BrowserHostViewProps } from './BrowserHost.types';

const NativeView =
  requireNativeView('BrowserHost') as React.ComponentType<
    BrowserHostViewProps & React.RefAttributes<BrowserHostViewHandle>
  >;

const BrowserHostView = React.forwardRef<BrowserHostViewHandle, BrowserHostViewProps>(
  function BrowserHostView(props, ref) {
    return <NativeView {...props} ref={ref as never} />;
  }
);

export default BrowserHostView;
