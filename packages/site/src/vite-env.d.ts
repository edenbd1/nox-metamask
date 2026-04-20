/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SNAP_ORIGIN?: string;
  readonly VITE_SNAP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
