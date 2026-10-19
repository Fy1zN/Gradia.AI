import { auth } from "../firebase";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Ask Firebase for the token on every request instead of caching it in localStorage.
// getIdToken() returns the cached token, or silently refreshes it if it is about to
// expire (tokens last ~1 hour). This fixes 401s in long sessions, and the token is
// no longer sitting in localStorage where any injected script could read it.
async function getToken(): Promise<string | null> {
  const user = auth.currentUser;
  return user ? await user.getIdToken() : null;
}

async function authHeaders(json = true): Promise<HeadersInit> {
  const token = await getToken();
  const headers: Record<string, string> = {};
  if (json)  headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json() as Promise<T>;
}

// Matches ClinicianResponse in main.py
export interface ClinicianProfile {
  clinician_id: string;
  firebase_uid: string;
  name:         string | null;
  email:        string;
  created_at:   string;
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
  me: async (): Promise<ClinicianProfile> => {
    const res = await fetch(`${BASE_URL}/auth/me`, { headers: await authHeaders() });
    return handleResponse<ClinicianProfile>(res);
  },
};

export const casesApi = {
  list: async (search = "", page = 1): Promise<CaseListResponse> => {
    const params = new URLSearchParams({ page: String(page), page_size: "20" });
    if (search) params.set("search", search);
    const res = await fetch(`${BASE_URL}/api/cases?${params}`, { headers: await authHeaders() });
    return handleResponse<CaseListResponse>(res);
  },

  get: async (caseId: string): Promise<CaseRecord> => {
    const res = await fetch(`${BASE_URL}/api/cases/${caseId}`, { headers: await authHeaders() });
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

    // No Content-Type here: the browser sets multipart/form-data with the boundary itself
    const res = await fetch(`${BASE_URL}/api/cases/upload`, {
      method:  "POST",
      headers: await authHeaders(false),
      body:    form,
    });
    return handleResponse<CaseRecord>(res);
  },

  delete: async (caseId: string): Promise<void> => {
    const res = await fetch(`${BASE_URL}/api/cases/${caseId}`, {
      method:  "DELETE",
      headers: await authHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "Delete failed");
    }
  },

  generateReport: async (
    caseId:  string,
    onChunk: (text: string) => void,
    onDone:  () => void,
    onError: (err: string) => void
  ): Promise<void> => {
    try {
      const res = await fetch(`${BASE_URL}/api/cases/${caseId}/report`, {
        method:  "POST",
        headers: await authHeaders(),
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