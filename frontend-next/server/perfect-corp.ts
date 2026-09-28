import type { NextRequest } from "next/server";

const PERFECT_API_BASE = "https://yce-api-01.makeupar.com/s2s/v2.0";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/jpg", "image/png"]);
const ALLOWED_GARMENT_CATEGORIES = new Set(["upper_body", "lower_body", "full_body"]);
const ALLOWED_RESULT_HOSTS = ["amazonaws.com", "makeupar.com", "perfectcorp.com"];

type PerfectResponse = {
  status?: number;
  error?: string;
  error_code?: string;
  data?: Record<string, unknown>;
};

type UploadRequest = {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
};

type PerfectFile = {
  file_id?: string;
  file_name?: string;
  content_type?: string;
  requests?: UploadRequest[];
};

class PerfectCorpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function apiKey() {
  const key = process.env.PERFECT_CORP_API_KEY?.trim();
  if (!key) throw new PerfectCorpError(503, "PERFECT_CORP_NOT_CONFIGURED");
  return key;
}

async function perfectFetch(path: string, init?: RequestInit): Promise<PerfectResponse> {
  const key = apiKey();
  let result: Response;
  try {
    result = await fetch(`${PERFECT_API_BASE}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${key}`,
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new PerfectCorpError(502, "PERFECT_CORP_UNAVAILABLE");
  }

  const payload = await result.json().catch(() => ({})) as PerfectResponse;
  if (!result.ok || (payload.status && payload.status >= 400)) {
    const code = payload.error_code ?? payload.error ?? "PERFECT_CORP_REQUEST_FAILED";
    throw new PerfectCorpError(result.status >= 400 ? result.status : 502, code);
  }
  return payload;
}

async function body(req: NextRequest) {
  try {
    return await req.json() as Record<string, unknown>;
  } catch {
    throw new PerfectCorpError(400, "INVALID_JSON");
  }
}

export async function handlePerfectCorpRequest(req: NextRequest, path: string) {
  if (path === "try-on/files" && req.method === "POST") {
    const payload = await body(req);
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (!files.length || files.length > 3) throw new PerfectCorpError(422, "INVALID_FILE_COUNT");

    const normalized = files.map((candidate) => {
      const item = candidate as Record<string, unknown>;
      const fileName = String(item.fileName ?? "").trim().slice(0, 180);
      const fileSize = Number(item.fileSize);
      const contentType = String(item.contentType ?? "").toLowerCase();
      if (!fileName || !Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_SIZE) {
        throw new PerfectCorpError(422, "INVALID_FILE_SIZE");
      }
      if (!ALLOWED_CONTENT_TYPES.has(contentType)) throw new PerfectCorpError(422, "INVALID_FILE_TYPE");
      return { file_name: fileName, file_size: fileSize, content_type: contentType };
    });

    const result = await perfectFetch("/file", {
      method: "POST",
      body: JSON.stringify({ files: normalized }),
    });
    const uploadedFiles = ((result.data?.files ?? []) as PerfectFile[]).map((file) => {
      const upload = file.requests?.[0];
      if (!file.file_id || !upload?.url) throw new PerfectCorpError(502, "INVALID_UPLOAD_RESPONSE");
      return {
        fileId: file.file_id,
        fileName: file.file_name,
        contentType: file.content_type,
        upload: { method: upload.method ?? "PUT", url: upload.url, headers: upload.headers ?? {} },
      };
    });
    if (uploadedFiles.length !== normalized.length) throw new PerfectCorpError(502, "INVALID_UPLOAD_RESPONSE");
    return { files: uploadedFiles };
  }

  if (path === "try-on/tasks" && req.method === "POST") {
    const payload = await body(req);
    const srcFileId = String(payload.srcFileId ?? "").trim();
    const srcFileUrl = String(payload.srcFileUrl ?? "").trim();
    const refFileId = String(payload.refFileId ?? "").trim();
    const garmentCategory = String(payload.garmentCategory ?? "").trim();
    if ((!srcFileId && !srcFileUrl) || (srcFileId && srcFileUrl) || !refFileId || !ALLOWED_GARMENT_CATEGORIES.has(garmentCategory)) {
      throw new PerfectCorpError(422, "INVALID_TRY_ON_REQUEST");
    }
    const result = await perfectFetch("/task/cloth-v4", {
      method: "POST",
      body: JSON.stringify({
        ...(srcFileId ? { src_file_id: srcFileId } : { src_file_url: srcFileUrl }),
        ref_file_id: refFileId,
        garment_category: garmentCategory,
      }),
    });
    const taskId = String(result.data?.task_id ?? "");
    if (!taskId) throw new PerfectCorpError(502, "INVALID_TASK_RESPONSE");
    return { taskId };
  }

  if (path === "try-on/download" && req.method === "POST") {
    const payload = await body(req);
    let resultUrl: URL;
    try {
      resultUrl = new URL(String(payload.url ?? ""));
    } catch {
      throw new PerfectCorpError(422, "INVALID_RESULT_URL");
    }
    const trustedHost = resultUrl.protocol === "https:"
      && ALLOWED_RESULT_HOSTS.some((host) => resultUrl.hostname === host || resultUrl.hostname.endsWith(`.${host}`));
    if (!trustedHost) throw new PerfectCorpError(422, "INVALID_RESULT_URL");
    const image = await fetch(resultUrl, { cache: "no-store" }).catch(() => null);
    if (!image?.ok) throw new PerfectCorpError(502, "RESULT_DOWNLOAD_FAILED");
    const contentType = image.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) throw new PerfectCorpError(502, "INVALID_RESULT_FILE");
    return new Response(image.body, {
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="kolbe-virtual-try-on.${contentType.includes("png") ? "png" : "jpg"}"`,
        "cache-control": "private, no-store",
      },
    });
  }

  const taskMatch = path.match(/^try-on\/tasks\/([^/]+)$/);
  if (taskMatch && req.method === "GET") {
    const result = await perfectFetch(`/task/cloth-v4/${encodeURIComponent(taskMatch[1])}`);
    const taskStatus = String(result.data?.task_status ?? "processing");
    const results = result.data?.results as { url?: string } | undefined;
    const taskError = result.data?.error as { code?: string; message?: string } | string | null | undefined;
    return {
      status: taskStatus,
      resultUrl: results?.url ?? null,
      error: typeof taskError === "string" ? taskError : taskError?.code ?? taskError?.message ?? null,
    };
  }

  throw new PerfectCorpError(404, "NOT_FOUND");
}

export function isPerfectCorpError(error: unknown): error is PerfectCorpError {
  return error instanceof PerfectCorpError;
}
