/**
 * Thin fetch wrapper for the backend API.
 *
 * Auth: reads role-specific tokens from localStorage and sends as Bearer token.
 * Base URL: empty (relies on Vite dev proxy or same-origin in prod).
 */

const LEGACY_STORAGE_KEY = "cvr_token";
const USER_STORAGE_KEY = "cvr_user_token";
const ADMIN_STORAGE_KEY = "cvr_admin_token";

export type AuthRole = "user" | "admin";
export type ThinkingMode = "enabled" | "disabled";
export type ModelNetworkMode = "direct" | "environment" | "proxy";

export type ApiError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  request_id?: string;
};

export class HttpError extends Error {
  status: number;
  payload: ApiError;
  constructor(status: number, payload: ApiError) {
    super(payload.message || `HTTP ${status}`);
    this.status = status;
    this.payload = payload;
  }
}

export class NetworkError extends Error {
  payload: ApiError;
  constructor(message = "无法连接后端服务，请确认前后端服务已启动") {
    super(message);
    this.payload = { code: "NETWORK_ERROR", message };
  }
}

function storageKey(role: AuthRole): string {
  return role === "admin" ? ADMIN_STORAGE_KEY : USER_STORAGE_KEY;
}

export function getToken(role: AuthRole = "user"): string | null {
  return localStorage.getItem(storageKey(role)) || localStorage.getItem(LEGACY_STORAGE_KEY);
}

export function setToken(token: string | null, role: AuthRole = "user") {
  if (token) localStorage.setItem(storageKey(role), token);
  else localStorage.removeItem(storageKey(role));
  if (token) localStorage.removeItem(LEGACY_STORAGE_KEY);
}

function tokenRoleForPath(path: string, explicit?: AuthRole): AuthRole | null {
  if (path.startsWith("/auth/")) return null;
  if (explicit) return explicit;
  if (path.startsWith("/admin")) return "admin";
  return "user";
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { isForm?: boolean; raw?: boolean; tokenRole?: AuthRole } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const tokenRole = tokenRoleForPath(path, opts.tokenRole);
  const token = tokenRole ? getToken(tokenRole) : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload: BodyInit | undefined;
  if (opts.isForm && body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let resp: Response;
  try {
    resp = await fetch(`/api/v1${path}`, { method, headers, body: payload });
  } catch {
    throw new NetworkError();
  }

  if (!resp.ok) {
    let err: ApiError;
    try {
      err = await resp.json();
    } catch {
      err = { code: "HTTP_ERROR", message: `HTTP ${resp.status}` };
    }
    throw new HttpError(resp.status, err);
  }

  if (resp.status === 204) return undefined as T;
  if (opts.raw) return (await resp.text()) as T;
  return (await resp.json()) as T;
}

export const api = {
  get: <T>(path: string, opts?: { tokenRole?: AuthRole; raw?: boolean }) =>
    request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: { tokenRole?: AuthRole }) =>
    request<T>("POST", path, body, opts),
  patch: <T>(path: string, body?: unknown, opts?: { tokenRole?: AuthRole }) =>
    request<T>("PATCH", path, body, opts),
  del: <T>(path: string, opts?: { tokenRole?: AuthRole }) =>
    request<T>("DELETE", path, undefined, opts),
  upload: <T>(
    path: string,
    file: File,
    opts?: { tokenRole?: AuthRole; fields?: Record<string, string | number | boolean | null | undefined> },
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    Object.entries(opts?.fields || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) fd.append(key, String(value));
    });
    return request<T>("POST", path, fd, { ...opts, isForm: true });
  },
};

// ---------------- typed surface ----------------

export type ParseStatus = "pending" | "processing" | "completed" | "failed";

export type CurrentUser = {
  user_id: string;
  username: string;
  is_admin: boolean;
  plan_tier: string;
};

export type AuthResponse = {
  user_id: string;
  username: string;
  token: string;
  is_admin: boolean;
  plan_tier: string;
};

export type ResumeData = {
  schema_version: string;
  basic_info: Record<string, string | number | null> & {
    parse_warnings?: string[];
  };
  job_intent: Record<string, string | string[] | null> | null;
  education: any[];
  internship_experience?: any[];
  work_experience: any[];
  campus_experience?: any[];
  project_experience: any[];
  skills: Record<string, string[]>;
  certifications: any[];
  languages: any[];
  self_evaluation: string | null;
  facts?: ResumeFact[];
  extra_sections?: { title: string; style?: "pills" | "list" | "text"; items: string[] }[];
};

export type ResumeFact = {
  key?: string | null;
  label: string;
  value: string;
  normalized_value?: string | number | boolean | string[] | null;
  value_type?: string;
  scope?: string;
  source_path?: string | null;
  source_text?: string | null;
  confidence?: number;
  sensitivity?: "none" | "low" | "sensitive";
  reuse_likelihood?: "high" | "medium" | "low";
};

export type ResumeDetail = {
  resume_id: string;
  status: ParseStatus;
  schema_version: string;
  parsed_data_version: number;
  data: ResumeData | null;
  error: string | null;
};

export type ModelConfig = {
  provider: "glm" | "qwen";
  model_thinking_mode: ThinkingMode;
  model_network_mode: ModelNetworkMode;
  model_proxy_url: string;
  glm_api_key: string;
  glm_base_url: string;
  glm_ocr_model: string;
  glm_vision_model: string;
  glm_chat_model: string;
  glm_reasoning_model: string;
  qwen_api_key: string;
  qwen_base_url: string;
  qwen_ocr_model: string;
  qwen_vision_model: string;
  qwen_chat_model: string;
  qwen_reasoning_model: string;
};

export type ModelTestResponse = {
  ok: boolean;
  provider: string;
  model_network_mode: ModelNetworkMode;
  chat_model: string;
  reasoning_model: string;
  latency_ms: number;
  sample: string;
  error: string | null;
};

export type AdminUserItem = {
  user_id: string;
  username: string;
  is_admin: boolean;
  plan_tier: string;
  created_at: string;
  resume_count: number;
  total_cost_cny: string;
};

export type StatsResponse = {
  total_users: number;
  total_resumes: number;
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_cny: string;
  by_stage: Record<string, { calls: number; cost_cny: string }>;
  by_model: Record<string, { calls: number; cost_cny: string }>;
};

export const endpoints = {
  // ---- auth ----
  registerUser: (username: string, password: string) =>
    api.post<AuthResponse>("/auth/user/register", { username, password }),
  loginUser: (username: string, password: string) =>
    api.post<AuthResponse>("/auth/user/login", { username, password }),
  adminBootstrapStatus: () =>
    api.get<{ needs_bootstrap: boolean }>("/auth/admin/bootstrap-status"),
  bootstrapAdmin: (username: string, password: string) =>
    api.post<AuthResponse>("/auth/admin/bootstrap", { username, password }),
  loginAdmin: (username: string, password: string) =>
    api.post<AuthResponse>("/auth/admin/login", { username, password }),

  // ---- self ----
  me: (role: AuthRole = "user") => api.get<CurrentUser>("/users/me", { tokenRole: role }),

  // ---- resumes ----
  listResumes: () => api.get<ResumeDetail[]>("/resumes"),
  getResume: (id: string) => api.get<ResumeDetail>(`/resumes/${id}`),
  uploadResume: (file: File, opts?: { thinkingMode?: ThinkingMode }) =>
    api.upload<ResumeDetail>("/resumes", file, {
      fields: { thinking_mode: opts?.thinkingMode },
    }),
  patchResume: (id: string, patch: Record<string, unknown>) =>
    api.patch<ResumeDetail>(`/resumes/${id}`, { patch }),
  deleteResume: (id: string) => api.del<void>(`/resumes/${id}`),
  reparseResume: (id: string) =>
    api.post<ResumeDetail>(`/resumes/${id}/reparse`),

  // ---- admin ----
  getModelConfig: () => api.get<ModelConfig>("/admin/config/model"),
  patchModelConfig: (payload: Partial<ModelConfig>) =>
    api.patch<ModelConfig>("/admin/config/model", payload),
  testModelConfig: () =>
    api.post<ModelTestResponse>("/admin/config/model/test"),
  listAdminUsers: () =>
    api.get<{ users: AdminUserItem[]; total: number }>("/admin/users"),
  adminStats: () => api.get<StatsResponse>("/admin/stats"),
};
