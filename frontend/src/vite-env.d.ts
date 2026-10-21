/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL, e.g. http://localhost:8000/api/v1 */
  readonly VITE_API_BASE_URL?: string;
  /** The SAC's time zone; times are shown on its clock wherever the browser is */
  readonly VITE_APP_TIMEZONE?: string;
  /** Optional Sentry DSN for error reporting */
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
