import { useState, useEffect, useCallback } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User
} from "firebase/auth";
import { auth, provider } from "../firebase";
import { authApi, casesApi, TokenStore, type CaseRecord } from "./gradiaApi";

// ── useAuth ────────────────────────────────────────────────────────────────
// Replaces all mock setUser() calls in the prototype

export function useAuth() {
  const [user, setUser]           = useState<User | null>(null);
  const [authLoading, setLoading] = useState(true);
  const [authError, setError]     = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const token = await firebaseUser.getIdToken();
        TokenStore.set(token);
        setUser(firebaseUser);
      } else {
        TokenStore.clear();
        setUser(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const loginWithGoogle = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, provider);
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
    TokenStore.clear();
    setUser(null);
  }, []);

  return { user, authLoading, authError, login, register, loginWithGoogle, logout };
}

// ── useCases ───────────────────────────────────────────────────────────────
// Replaces dataset state array

export function useCases() {
  const [cases, setCases]           = useState<CaseRecord[]>([]);
  const [total, setTotal]           = useState(0);
  const [casesLoading, setLoading]  = useState(false);
  const [casesError, setError]      = useState<string | null>(null);

  const fetchCases = useCallback(async (search = "", page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const data = await casesApi.list(search, page);
      setCases(data.cases);
      setTotal(data.total);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCases(); }, [fetchCases]);

  return { cases, total, casesLoading, casesError, fetchCases };
}

// ── useUpload ──────────────────────────────────────────────────────────────
// Replaces handleIngestionSubmit mock

export function useUpload(onSuccess: (newCase: CaseRecord) => void) {
  const [uploading, setUploading]   = useState(false);
  const [uploadError, setError]     = useState<string | null>(null);

  const submitCase = useCallback(async (
    age:           number,
    sex:           string,
    localization:  string,
    clinicalNotes: string,
    imageFile:     File
  ) => {
    setUploading(true);
    setError(null);
    try {
      const newCase = await casesApi.upload(age, sex, localization, clinicalNotes, imageFile);
      onSuccess(newCase);
      return newCase;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setUploading(false);
    }
  }, [onSuccess]);

  return { uploading, uploadError, submitCase };
}

// ── useReport ──────────────────────────────────────────────────────────────
// Replaces handleGenerateReport mock + direct Gemini fetch

export function useReport() {
  const [report, setReport]         = useState("");
  const [isGenerating, setGenerating] = useState(false);
  const [reportError, setError]     = useState<string | null>(null);

  const generateReport = useCallback(async (caseId: string) => {
    setGenerating(true);
    setReport("");
    setError(null);

    await casesApi.generateReport(
      caseId,
      (chunk) => setReport(prev => prev + chunk),
      ()      => setGenerating(false),
      (err)   => { setError(err); setGenerating(false); }
    );
  }, []);

  const clearReport = useCallback(() => {
    setReport("");
    setError(null);
  }, []);

  return { report, isGenerating, reportError, generateReport, clearReport };
}