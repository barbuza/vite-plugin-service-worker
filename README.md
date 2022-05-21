# @barbuza/vite-plugin-service-worker

add to vite:

```typescript
import { serviceWorkerPlugin } from "@barbuza/vite-plugin-service-worker";

defineConfig({
  plugins: [
    serviceWorkerPlugin()
  ]
}) 
```

import service worker url

```typescript
import workerUrl from "./worker?service-worker";
```
