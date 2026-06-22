const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const TokenStore = {
  get: ()          => localStorage.getItem("gradia_token"),
  set: (t: string) => localStorage.setItem("gradia_token", t),
  clear: ()        => localStorage.removeItem("gradia_token"),
};

function authHeaders(): HeadersInit {
  const token = TokenStore.get();
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json() as Promise<T>;
}

export interface AuthResponse {
  access_token: string;
  token_type:   string;
  clinician_id: string;
  name:         string;
  email:        string;
}

export interface CaseRecord {
  case_id:          string;
  lesion_id:        string;
  age:              number;
  sex:              string;
  localization:     string;
  clinical_notes:   string | null;
  image_path:       string;
  predicted_class:  string;
  confidence_score: number;
  heatmap_path:     string;
  severity:         string;
  description:      string;
  created_at:       string;
}

export interface CaseListResponse {
  cases:     CaseRecord[];
  total:     number;
  page:      number;
  page_size: number;
}

export const authApi = {
  me: async (): Promise<AuthResponse> => {
    const res = await fetch(`${BASE_URL}/auth/me`, { headers: authHeaders() });
    return handleResponse<AuthResponse>(res);
  },

  logout: () => {
    TokenStore.clear();
  },
};

export const casesApi = {
  list: async (search = "", page = 1): Promise<CaseListResponse> => {
    const params = new URLSearchParams({ page: String(page), page_size: "20" });
    if (search) params.set("search", search);
    const res = await fetch(`${BASE_URL}/api/cases?${params}`, { headers: authHeaders() });
    return handleResponse<CaseListResponse>(res);
  },

  get: async (caseId: string): Promise<CaseRecord> => {
    const res = await fetch(`${BASE_URL}/api/cases/${caseId}`, { headers: authHeaders() });
    return handleResponse<CaseRecord>(res);
  },

  upload: async (
    age:           number,
    sex:           string,
    localization:  string,
    clinicalNotes: string,
    imageFile:     File
  ): Promise<CaseRecord> => {
    const form = new FormData();
    form.append("age", String(age));
    form.append("sex", sex);
    form.append("localization", localization);
    if (clinicalNotes) form.append("clinical_notes", clinicalNotes);
    form.append("image", imageFile);

    const token = TokenStore.get();
    const res = await fetch(`${BASE_URL}/api/cases/upload`, {
      method:  "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body:    form,
    });
    return handleResponse<CaseRecord>(res);
  },

  generateReport: async (
    caseId:  string,
    onChunk: (text: string) => void,
    onDone:  () => void,
    onError: (err: string) => void
  ): Promise<void> => {
    const token = TokenStore.get();
    try {
      const res = await fetch(`${BASE_URL}/api/cases/${caseId}/report`, {
        method:  "POST",
        headers: token
          ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
          : { "Content-Type": "application/json" },
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ detail: "Report generation failed" }));
        onError(err.detail);
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onChunk(decoder.decode(value, { stream: true }));
      }
      onDone();
    } catch (err: any) {
      onError(err.message || "Network error");
    }
  },
};