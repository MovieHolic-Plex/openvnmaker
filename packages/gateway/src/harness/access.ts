const STUDIO_ORIGINS = new Set([
  "http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:4173", "http://localhost:4173",
]);
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

export function studioRequestAllowed(input: {
  readonly origin: string | undefined;
  readonly host: string | undefined;
  readonly studio: string | undefined;
}): boolean {
  if (input.studio !== "1") return false;
  if (!LOOPBACK_HOST.test(input.host ?? "")) return false;
  if (input.origin !== undefined && !STUDIO_ORIGINS.has(input.origin)) return false;
  return true;
}

export function headersFrom(request: { header: (name: string) => string | undefined }): {
  readonly origin: string | undefined;
  readonly host: string | undefined;
  readonly studio: string | undefined;
} {
  return {
    origin: request.header("origin"),
    host: request.header("host"),
    studio: request.header("x-vnmaker-studio"),
  };
}
