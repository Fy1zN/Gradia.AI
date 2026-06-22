import React, { useState, useEffect, useRef } from "react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { useAuth, useCases, useUpload, useReport } from "./api/hooks";
import type { CaseRecord } from "./api/gradiaApi";

const C = {
  bg:        "#0a0a0b",
  surface:   "#111112",
  border:    "#1e1e1f",
  amber:     "#f59e0b",
  amberDim:  "#92400e",
  amberGlow: "rgba(245,158,11,0.12)",
  text:      "#e8e3d8",
  textMuted: "#6b6560",
  textDim:   "#9c9590",
  danger:    "#ef4444",
  safe:      "#22c55e",
  warn:      "#f97316",
};

function severityColor(s: string) {
  if (!s) return C.textDim;
  const l = s.toLowerCase();
  if (l.includes("high"))   return C.danger;
  if (l.includes("moderate")) return C.warn;
  if (l.includes("benign") || l.includes("safe")) return C.safe;
  return C.textDim;
}

function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let animId: number;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    const particles = Array.from({ length: 55 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 1.5 + 0.5,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      opacity: Math.random() * 0.35 + 0.08,
      ring: Math.random() > 0.55,
      ringR: Math.random() * 9 + 4,
    }));
    let scanY = -40;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.save(); ctx.globalAlpha = p.opacity;
        if (p.ring) {
          ctx.beginPath(); ctx.arc(p.x, p.y, p.ringR, 0, Math.PI * 2);
          ctx.strokeStyle = C.amber; ctx.lineWidth = 0.35; ctx.stroke();
          ctx.beginPath(); ctx.arc(p.x, p.y, 0.8, 0, Math.PI * 2);
          ctx.fillStyle = C.amber; ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = C.amber; ctx.fill();
        }
        ctx.restore();
      });
      scanY += 0.35;
      if (scanY > canvas.height + 40) scanY = -40;
      const sg = ctx.createLinearGradient(0, scanY - 35, 0, scanY + 35);
      sg.addColorStop(0, "transparent"); sg.addColorStop(0.4, "rgba(245,158,11,0.03)");
      sg.addColorStop(0.5, "rgba(245,158,11,0.1)"); sg.addColorStop(0.6, "rgba(245,158,11,0.03)");
      sg.addColorStop(1, "transparent");
      ctx.fillStyle = sg; ctx.fillRect(0, scanY - 35, canvas.width, 70);
      ctx.beginPath(); ctx.moveTo(0, scanY); ctx.lineTo(canvas.width, scanY);
      ctx.strokeStyle = "rgba(245,158,11,0.15)"; ctx.lineWidth = 0.6; ctx.stroke();
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }} />;
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 9, fontFamily: "'Space Mono', monospace", textTransform: "uppercase", letterSpacing: "0.1em", padding: "2px 8px", borderRadius: 4, border: `1px solid ${color}40`, color, backgroundColor: `${color}10` }}>
      {label}
    </span>
  );
}

function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", textTransform: "uppercase", letterSpacing: "0.12em", color: C.textMuted }}>{label}</label>
      <input {...props} style={{ background: C.surface, borderRadius: 8, border: `1px solid ${focused ? C.amber : C.border}`, padding: "10px 14px", color: C.text, fontSize: 13, outline: "none", fontFamily: "'Outfit', sans-serif", width: "100%", boxSizing: "border-box", transition: "border-color 0.15s", ...props.style }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
    </div>
  );
}

function Select({ label, options, ...props }: { label: string; options: string[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", textTransform: "uppercase", letterSpacing: "0.12em", color: C.textMuted }}>{label}</label>
      <select {...props} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", color: C.text, fontSize: 13, outline: "none", fontFamily: "'Outfit', sans-serif", width: "100%", boxSizing: "border-box" }}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  const [hov, setHov] = useState(false);
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} style={{ border: `1px solid ${hov ? C.amber : C.border}`, borderRadius: 12, background: "rgba(17,17,18,0.85)", backdropFilter: "blur(8px)", padding: "22px 18px", textAlign: "left", transition: "all 0.2s", boxShadow: hov ? `0 0 20px rgba(245,158,11,0.08)` : "none" }}>
      <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: 14, color: C.text, marginBottom: 8 }}>{title}</p>
      <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 300, fontSize: 12, color: C.textMuted, lineHeight: 1.6 }}>{desc}</p>
    </div>
  );
}

function Btn({ children, onClick, disabled, variant = "primary", full }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: "primary" | "ghost"; full?: boolean; }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} disabled={disabled} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} style={{ width: full ? "100%" : undefined, padding: "11px 24px", borderRadius: 8, fontFamily: "'Space Mono', monospace", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, transition: "all 0.2s", border: variant === "primary" ? "none" : `1px solid ${hov ? C.amber : C.border}`, background: variant === "primary" ? C.amber : "transparent", color: variant === "primary" ? "#0a0a0b" : hov ? C.amber : C.textDim, boxShadow: variant === "primary" ? `0 0 ${hov ? "32px" : "20px"} rgba(245,158,11,${hov ? "0.5" : "0.25"})` : hov ? `0 0 16px rgba(245,158,11,0.15)` : "none", transform: hov && !disabled ? "translateY(-1px)" : "none" }}>
      {children}
    </button>
  );
}

export default function App() {
  const [page, setPage]                 = useState<"landing"|"auth"|"ingestion"|"terminal">("landing");
  const [authMode, setAuthMode]         = useState<"login"|"register">("login");
  const [selectedCase, setSelectedCase] = useState<CaseRecord | null>(null);
  const [gradCamAlpha, setGradCamAlpha] = useState(0.5);
  const [searchTerm, setSearchTerm]     = useState("");
  const [isAnalyzing, setIsAnalyzing]   = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const { user, authLoading, authError, login, register, loginWithGoogle, logout } = useAuth();
  const [authEmail, setAuthEmail]       = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const { cases, casesLoading, fetchCases } = useCases();

  // Ingestion fields
  const [uploadAge, setUploadAge]         = useState("45");
  const [uploadSex, setUploadSex]         = useState("Female");
  const [uploadLoc, setUploadLoc]         = useState("Anterior Trunk");
  const [uploadNotes, setUploadNotes]     = useState("");
  const [patientName, setPatientName]     = useState("");
  const [patientRef, setPatientRef]       = useState("");
  const [skinType, setSkinType]           = useState("III");
  const [duration, setDuration]           = useState("< 1 month");
  const [symptoms, setSymptoms]           = useState("No symptoms");
  const [familyHistory, setFamilyHistory] = useState("No");
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [rawFile, setRawFile]             = useState<File | null>(null);
  const fileInputRef                      = useRef<HTMLInputElement>(null);
  const reportRef                         = useRef<HTMLDivElement>(null);

  const { uploading, uploadError, submitCase } = useUpload((newCase) => { setSelectedCase(newCase); setPage("terminal"); });
  const { report, isGenerating, reportError, generateReport, clearReport } = useReport();

  useEffect(() => { if (page === "terminal") fetchCases(searchTerm); }, [searchTerm, page]);
  useEffect(() => { if (user && page === "auth") setPage("ingestion"); }, [user]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRawFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setUploadedImage(reader.result as string);
    reader.readAsDataURL(file);
  };

  const buildClinicalNotes = () => {
    const parts = [];
    if (patientName)   parts.push(`Patient: ${patientName}`);
    if (patientRef)    parts.push(`Ref: ${patientRef}`);
    parts.push(`Skin Type: Fitzpatrick ${skinType}`);
    parts.push(`Duration: ${duration}`);
    parts.push(`Symptoms: ${symptoms}`);
    parts.push(`Family history of skin cancer: ${familyHistory}`);
    if (uploadNotes)   parts.push(`Notes: ${uploadNotes}`);
    return parts.join(" | ");
  };

  const handleIngestionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawFile) return;
    setIsAnalyzing(true);
    await submitCase(parseInt(uploadAge), uploadSex, uploadLoc, buildClinicalNotes(), rawFile);
    setIsAnalyzing(false);
  };

  const handleCaseSelect = (c: CaseRecord) => {
    setIsAnalyzing(true); setSelectedCase(c); clearReport();
    setTimeout(() => setIsAnalyzing(false), 800);
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    authMode === "login" ? await login(authEmail, authPassword) : await register(authEmail, authPassword);
  };

  // PDF export
  const handleExportPdf = async () => {
    if (!selectedCase || !report) return;
    setExportingPdf(true);
    try {
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const margin = 18;
      let y = 20;

      // Header
      pdf.setFillColor(10, 10, 11);
      pdf.rect(0, 0, pageW, 30, "F");
      pdf.setTextColor(245, 158, 11);
      pdf.setFontSize(18);
      pdf.setFont("helvetica", "bold");
      pdf.text("GRADIA.AI", margin, 14);
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(156, 149, 144);
      pdf.text("Explainable AI Dermascope Terminal — Research Platform", margin, 20);
      pdf.text(`Generated: ${new Date().toLocaleString()}`, margin, 25);
      y = 40;

      // Case summary box
      pdf.setDrawColor(30, 30, 31);
      pdf.setFillColor(17, 17, 18);
      pdf.roundedRect(margin, y, pageW - margin * 2, 38, 3, 3, "FD");
      pdf.setTextColor(245, 158, 11);
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "bold");
      pdf.text("CASE SUMMARY", margin + 6, y + 8);
      pdf.setTextColor(232, 227, 216);
      pdf.setFontSize(9);
      pdf.text(`Case ID: ${selectedCase.case_id}`, margin + 6, y + 16);
      pdf.text(`Classification: ${selectedCase.predicted_class}`, margin + 6, y + 23);
      pdf.text(`Confidence: ${selectedCase.confidence_score?.toFixed(1)}%`, margin + 6, y + 30);
      pdf.text(`Demographics: ${selectedCase.age}y ${selectedCase.sex} — ${selectedCase.localization}`, pageW / 2, y + 16);
      pdf.text(`Severity: ${selectedCase.severity}`, pageW / 2, y + 23);
      pdf.text(`Date: ${new Date(selectedCase.created_at).toLocaleDateString()}`, pageW / 2, y + 30);
      y += 48;

      // Images side by side
      if (selectedCase.image_path && selectedCase.heatmap_path) {
        pdf.setTextColor(156, 149, 144);
        pdf.setFontSize(7);
        pdf.setFont("helvetica", "normal");
        pdf.text("ORIGINAL DERMOSCOPY", margin, y);
        pdf.text("GRAD-CAM ACTIVATION MAP", pageW / 2 + 2, y);
        y += 4;

        try {
          // Original image
          const origImg = new Image();
          origImg.crossOrigin = "anonymous";
          await new Promise((res, rej) => {
            origImg.onload = res; origImg.onerror = rej;
            origImg.src = selectedCase.image_path;
          });
          const origCanvas = document.createElement("canvas");
          origCanvas.width = origImg.naturalWidth; origCanvas.height = origImg.naturalHeight;
          origCanvas.getContext("2d")!.drawImage(origImg, 0, 0);
          pdf.addImage(origCanvas.toDataURL("image/jpeg"), "JPEG", margin, y, 78, 58);
        } catch { pdf.setTextColor(100, 100, 100); pdf.text("Image unavailable", margin + 20, y + 28); }

        try {
          // Heatmap image
          const hmImg = new Image();
          hmImg.crossOrigin = "anonymous";
          await new Promise((res, rej) => {
            hmImg.onload = res; hmImg.onerror = rej;
            hmImg.src = selectedCase.heatmap_path;
          });
          const hmCanvas = document.createElement("canvas");
          hmCanvas.width = hmImg.naturalWidth; hmCanvas.height = hmImg.naturalHeight;
          hmCanvas.getContext("2d")!.drawImage(hmImg, 0, 0);
          pdf.addImage(hmCanvas.toDataURL("image/jpeg"), "JPEG", pageW / 2 + 2, y, 78, 58);
        } catch { pdf.setTextColor(100, 100, 100); pdf.text("Heatmap unavailable", pageW / 2 + 22, y + 28); }

        y += 66;
      }

      // Clinical notes
      if (selectedCase.clinical_notes) {
        pdf.setDrawColor(30, 30, 31);
        pdf.setFillColor(17, 17, 18);
        pdf.roundedRect(margin, y, pageW - margin * 2, 16, 2, 2, "FD");
        pdf.setTextColor(245, 158, 11);
        pdf.setFontSize(7);
        pdf.setFont("helvetica", "bold");
        pdf.text("CLINICAL NOTES", margin + 4, y + 6);
        pdf.setTextColor(156, 149, 144);
        pdf.setFont("helvetica", "normal");
        const noteLines = pdf.splitTextToSize(selectedCase.clinical_notes, pageW - margin * 2 - 8);
        pdf.text(noteLines[0] || "", margin + 4, y + 12);
        y += 22;
      }

      // Pathology report
      pdf.addPage();
      y = 20;
      pdf.setTextColor(245, 158, 11);
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "bold");
      pdf.text("PATHOLOGY REPORT", margin, y);
      pdf.setTextColor(156, 149, 144);
      pdf.setFontSize(7);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Case: ${selectedCase.case_id} — GRADIA.AI Draft`, margin, y + 6);
      y += 14;

      const lines = report.split("\n");
      for (const line of lines) {
        if (y > 270) { pdf.addPage(); y = 20; }
        if (line.startsWith("## ")) {
          pdf.setTextColor(232, 227, 216);
          pdf.setFontSize(9);
          pdf.setFont("helvetica", "bold");
          pdf.text(line.replace("## ", "").toUpperCase(), margin, y);
          y += 6;
        } else if (line.startsWith("### ")) {
          pdf.setTextColor(245, 158, 11);
          pdf.setFontSize(8);
          pdf.setFont("helvetica", "bold");
          pdf.text(line.replace("### ", ""), margin, y);
          y += 5;
        } else if (line.startsWith("**") && line.endsWith("**")) {
          pdf.setTextColor(232, 227, 216);
          pdf.setFontSize(8);
          pdf.setFont("helvetica", "bold");
          pdf.text(line.replace(/\*\*/g, ""), margin, y);
          y += 5;
        } else if (line.trim()) {
          pdf.setTextColor(156, 149, 144);
          pdf.setFontSize(7.5);
          pdf.setFont("helvetica", "normal");
          const wrapped = pdf.splitTextToSize(line.replace(/\*\*/g, ""), pageW - margin * 2);
          pdf.text(wrapped, margin, y);
          y += wrapped.length * 4.5;
        } else {
          y += 3;
        }
      }

      pdf.save(`GRADIA_${selectedCase.case_id}_${new Date().toISOString().split("T")[0]}.pdf`);
    } catch (err) {
      console.error("PDF export failed:", err);
    } finally {
      setExportingPdf(false);
    }
  };

  const Nav = () => (
    <nav style={{ position: "sticky", top: 0, zIndex: 50, background: `${C.bg}dd`, backdropFilter: "blur(14px)", padding: "0 36px", height: 58, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
        <div onClick={() => setPage("landing")} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: C.amber, boxShadow: `0 0 7px ${C.amber}`, display: "inline-block" }} />
          <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, color: C.text, letterSpacing: "0.05em", fontStyle: "italic" }}>
            Gradia<span style={{ color: C.amber, fontStyle: "normal", fontFamily: "'Space Mono', monospace", fontSize: 13 }}>.AI</span>
          </span>
        </div>
        {user && page !== "landing" && (
          <div style={{ display: "flex", gap: 24 }}>
            {(["ingestion", "terminal"] as const).map(p => (
              <button key={p} onClick={() => setPage(p)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: page === p ? C.amber : C.textMuted, fontWeight: page === p ? 700 : 400 }}>
                {p === "ingestion" ? "[ Ingest ]" : "[ Terminal ]"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {user ? (
          <><span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: C.textMuted }}>{user.email}</span><Btn variant="ghost" onClick={logout}>Logout</Btn></>
        ) : (
          <Btn onClick={() => setPage("auth")}>Sign In</Btn>
        )}
      </div>
    </nav>
  );

  //  LANDING 
  if (page === "landing") return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text }}>
      <Nav />
      <div style={{ position: "relative", overflow: "hidden", minHeight: "calc(100vh - 58px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 24px", textAlign: "center" }}>
        <ParticleField />
        <div style={{ position: "absolute", top: "45%", left: "50%", transform: "translate(-50%, -50%)", width: 800, height: 500, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(245,158,11,0.07) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />
        <div style={{ position: "relative", zIndex: 1, maxWidth: 740 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1px solid ${C.amberDim}`, borderRadius: 20, padding: "5px 18px", marginBottom: 40, background: "rgba(146,64,14,0.12)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.amber, boxShadow: `0 0 5px ${C.amber}`, display: "inline-block" }} />
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: C.amber, letterSpacing: "0.18em", textTransform: "uppercase" }}>Clinical AI Research Platform — v1.0</span>
          </div>
          <h1 style={{ marginBottom: 24, lineHeight: 1.06 }}>
            <span style={{ display: "block", fontFamily: "'Outfit', sans-serif", fontWeight: 300, fontSize: "clamp(22px, 3vw, 38px)", color: C.textDim, letterSpacing: "-0.01em", marginBottom: 6 }}>AI-Powered Dermoscopy Analysis</span>
            <span style={{ display: "block", fontFamily: "'DM Serif Display', serif", fontWeight: 400, fontSize: "clamp(30px, 5vw, 60px)", color: C.amber, letterSpacing: "-0.02em", fontStyle: "italic" }}>Results in seconds.</span>
          </h1>
          <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 300, fontSize: 15, color: C.textDim, maxWidth: 500, margin: "0 auto 44px", lineHeight: 1.8 }}>
            Upload a skin lesion image and get instant AI classification, visual explanation maps, and a formal diagnostic draft — ready for clinical review.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginBottom: 48 }}>
            <Btn onClick={() => user ? setPage("ingestion") : setPage("auth")}>Upload Skin Scan</Btn>
            <Btn variant="ghost" onClick={() => setPage("terminal")}>View Cases</Btn>
          </div>
          <div style={{ width: "100vw", marginLeft: "calc(-50vw + 50%)", overflow: "hidden", marginBottom: 48, padding: "11px 0" }}>
            <div style={{ display: "flex", gap: 56, animation: "marquee 28s linear infinite", width: "max-content" }}>
              {[...Array(2)].map((_, i) => (
                <div key={i} style={{ display: "flex", gap: 56, alignItems: "center" }}>
                  {["Melanoma (MEL)","Basal Cell Carcinoma (BCC)","Melanocytic Nevus (NV)","Actinic Keratosis (AKIEC)","Benign Keratosis (BKL)","Dermatofibroma (DF)","Vascular Lesion (VASC)"].map(item => (
                    <span key={item} style={{ display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}>
                      <span style={{ width: 3, height: 3, borderRadius: "50%", background: C.amber, display: "inline-block", opacity: 0.5 }} />
                      <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: C.textMuted, letterSpacing: "0.14em", textTransform: "uppercase" }}>{item}</span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, maxWidth: 680, margin: "0 auto" }}>
            <FeatureCard title="Instant Results" desc="Upload and receive classification in under 3 seconds" />
            <FeatureCard title="Visual Explanation" desc="See exactly which pixels drove the AI decision via Grad-CAM" />
            <FeatureCard title="Clinical Draft" desc="Auto-generated pathology report ready for physician review" />
          </div>
        </div>
      </div>
      <Footer page={page} caseId={selectedCase?.case_id} />
      <GS />
    </div>
  );

  //  AUTH 
  if (page === "auth") return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text }}>
      <Nav />
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "calc(100vh - 58px)", padding: 24, position: "relative" }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(245,158,11,0.07) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ width: "100%", maxWidth: 420, position: "relative", zIndex: 1, border: `1px solid ${C.border}`, borderRadius: 16, background: C.surface, padding: 36 }}>
          <div style={{ marginBottom: 28, textAlign: "center" }}>
            <h2 style={{ fontFamily: "'DM Serif Display', serif", fontStyle: "italic", fontSize: 26, color: C.text, marginBottom: 8 }}>{authMode === "login" ? "Welcome back" : "Create account"}</h2>
            <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 300, fontSize: 13, color: C.textMuted }}>Access the GRADIA.AI diagnostic terminal</p>
          </div>
          <form onSubmit={handleAuthSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <Input label="Email" type="email" required placeholder="clinician@hospital.org" value={authEmail} onChange={e => setAuthEmail(e.target.value)} />
            <Input label="Password" type="password" required placeholder="••••••••••" value={authPassword} onChange={e => setAuthPassword(e.target.value)} />
            {authError && <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: C.danger }}>{authError}</p>}
            <Btn full disabled={authLoading}>{authLoading ? "Authenticating..." : authMode === "login" ? "Sign In" : "Register"}</Btn>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, height: 1, background: C.border }} />
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: C.textMuted }}>OR</span>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>
            <button type="button" onClick={loginWithGoogle} style={{ width: "100%", padding: "11px 22px", borderRadius: 8, fontFamily: "'Space Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", border: `1px solid ${C.border}`, background: "transparent", color: C.textDim }}>
              Continue with Google
            </button>
          </form>
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${C.border}`, textAlign: "center" }}>
            <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: C.textMuted }}>
              {authMode === "login" ? "No account? " : "Have an account? "}
              <button onClick={() => setAuthMode(authMode === "login" ? "register" : "login")} style={{ background: "none", border: "none", cursor: "pointer", color: C.amber, fontFamily: "'Outfit', sans-serif", fontSize: 12 }}>
                {authMode === "login" ? "Register" : "Sign in"}
              </button>
            </p>
          </div>
        </div>
      </div>
      <GS />
    </div>
  );

  //  INGESTION 
  if (page === "ingestion") return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, overflowY: "auto" }}>
      <Nav />
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "40px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 16, background: C.surface, padding: 32 }}>
          <h2 style={{ fontFamily: "'DM Serif Display', serif", fontStyle: "italic", fontSize: 22, color: C.text, marginBottom: 6 }}>New Scan</h2>
          <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 300, fontSize: 12, color: C.textMuted, marginBottom: 24 }}>Enter patient details and upload the dermoscopy image.</p>
          <form onSubmit={handleIngestionSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Patient info */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Input label="Patient Name" type="text" placeholder="Optional" value={patientName} onChange={e => setPatientName(e.target.value)} />
              <Input label="Patient Ref / ID" type="text" placeholder="Hospital ref" value={patientRef} onChange={e => setPatientRef(e.target.value)} />
            </div>

            {/* Demographics */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Input label="Age" type="number" min="1" max="120" value={uploadAge} onChange={e => setUploadAge(e.target.value)} required />
              <Select label="Sex" options={["Female", "Male", "Unknown"]} value={uploadSex} onChange={e => setUploadSex(e.target.value)} />
            </div>

            <Select label="Localization" options={["Anterior Trunk", "Posterior Trunk", "Upper Extremity", "Lower Extremity", "Face & Neck", "Scalp", "Hand", "Foot", "Genital", "Ear", "Acral"]} value={uploadLoc} onChange={e => setUploadLoc(e.target.value)} />

            {/* Clinical details */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Select label="Fitzpatrick Skin Type" options={["I", "II", "III", "IV", "V", "VI"]} value={skinType} onChange={e => setSkinType(e.target.value)} />
              <Select label="Lesion Duration" options={["< 1 month", "1–6 months", "6–12 months", "1–2 years", "> 2 years", "Unknown"]} value={duration} onChange={e => setDuration(e.target.value)} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Select label="Symptoms" options={["No symptoms", "Itching", "Bleeding", "Pain", "Crusting", "Multiple symptoms"]} value={symptoms} onChange={e => setSymptoms(e.target.value)} />
              <Select label="Family History (Skin Cancer)" options={["No", "Yes", "Unknown"]} value={familyHistory} onChange={e => setFamilyHistory(e.target.value)} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", textTransform: "uppercase", letterSpacing: "0.12em", color: C.textMuted }}>Additional Clinical Notes</label>
              <textarea value={uploadNotes} onChange={e => setUploadNotes(e.target.value)} placeholder="Optional additional observations..." rows={2} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", color: C.text, fontSize: 13, outline: "none", fontFamily: "'Outfit', sans-serif", resize: "vertical" }} />
            </div>

            {uploadError && <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: C.danger }}>{uploadError}</p>}
            <Btn full disabled={uploading || !rawFile}>{uploading || isAnalyzing ? "Processing..." : "Run Inference"}</Btn>
          </form>
        </div>

        <div style={{ border: `1px solid ${C.border}`, borderRadius: 16, background: C.surface, padding: 32, display: "flex", flexDirection: "column", gap: 20 }}>
          <h2 style={{ fontFamily: "'DM Serif Display', serif", fontStyle: "italic", fontSize: 22, color: C.text }}>Image Upload</h2>
          <div onClick={() => fileInputRef.current?.click()} style={{ flex: 1, minHeight: 220, border: `2px dashed ${rawFile ? C.amber : C.border}`, borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s", background: rawFile ? "rgba(245,158,11,0.05)" : "transparent", gap: 12, padding: 24 }}>
            {uploadedImage ? (
              <img src={uploadedImage} alt="Preview" style={{ maxHeight: 200, maxWidth: "100%", borderRadius: 8, objectFit: "cover" }} />
            ) : (
              <>
                <div style={{ width: 52, height: 52, borderRadius: "50%", border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 22, color: C.textMuted }}>+</span>
                </div>
                <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 300, fontSize: 13, color: C.textMuted, textAlign: "center" }}>
                  Click to upload dermoscopy image<br />
                  <span style={{ fontSize: 11, color: C.border }}>JPG, PNG supported</span>
                </p>
              </>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} style={{ display: "none" }} />
          {rawFile && <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: C.textMuted }}><span style={{ color: C.amber }}>FILE: </span>{rawFile.name}</p>}

          {/* Field summary preview */}
          {(patientName || patientRef) && (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", background: C.bg }}>
              <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: C.amber, textTransform: "uppercase", marginBottom: 8 }}>Report will include</p>
              {patientName && <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: C.textDim }}>Patient: {patientName}</p>}
              {patientRef  && <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: C.textDim }}>Ref: {patientRef}</p>}
              <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: C.textDim }}>Fitzpatrick {skinType} — {duration} — {symptoms}</p>
              <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: C.textDim }}>Family history: {familyHistory}</p>
            </div>
          )}
        </div>
      </div>
      <Footer page={page} caseId={selectedCase?.case_id} />
      <GS />
    </div>
  );

  //  TERMINAL 
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, display: "flex", flexDirection: "column" }}>
      <Nav />
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "290px 1fr 310px", gap: 14, padding: "16px 18px", height: "calc(100vh - 90px)", overflow: "hidden" }}>

        {/* LEFT — Case Explorer */}
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "16px 14px 12px", borderBottom: `1px solid ${C.border}` }}>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: C.amber, textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 12 }}>Case Explorer</p>
            <input placeholder="Search ID, diagnosis, location..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", color: C.text, fontSize: 11, fontFamily: "'Outfit', sans-serif", outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "scroll", padding: "10px 10px", display: "flex", flexDirection: "column", gap: 7 }}>
            {casesLoading ? (
              <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: C.textMuted, textAlign: "center", paddingTop: 40 }}>Loading...</p>
            ) : cases.length === 0 ? (
              <div style={{ textAlign: "center", paddingTop: 40 }}>
                <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: C.textMuted, marginBottom: 14 }}>No cases yet.</p>
                <button onClick={() => setPage("ingestion")} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontFamily: "'Space Mono', monospace", fontSize: 9, color: C.amber, textTransform: "uppercase", letterSpacing: "0.1em" }}>Upload first scan</button>
              </div>
            ) : cases.map(c => (
              <div key={c.case_id} onClick={() => handleCaseSelect(c)} style={{ border: `1px solid ${selectedCase?.case_id === c.case_id ? C.amber : C.border}`, borderRadius: 10, padding: "11px 13px", cursor: "pointer", background: selectedCase?.case_id === c.case_id ? "rgba(245,158,11,0.07)" : "transparent", transition: "all 0.15s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                  <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, fontWeight: 700, color: C.text }}>{c.case_id}</span>
                  <Tag label={c.severity} color={severityColor(c.severity)} />
                </div>
                <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: C.textDim, marginBottom: 2 }}>{c.predicted_class}</p>
                <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: C.textMuted }}>{c.age}y {c.sex} — {c.localization}</p>
              </div>
            ))}
          </div>
          <div style={{ padding: "9px 14px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: C.textMuted }}>{cases.length} cases</span>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: selectedCase ? C.amber : C.textMuted }}>{selectedCase ? selectedCase.case_id : "none"}</span>
          </div>
        </div>

        {/* CENTER — Visual Core */}
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, display: "flex", flexDirection: "column", overflow: "hidden", padding: 18, gap: 14 }}>
          <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: C.amber, textTransform: "uppercase", letterSpacing: "0.15em" }}>Visual Core</p>
          <div style={{ flex: 1, position: "relative", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", minHeight: 280, maxHeight: 360 }}>
            {isAnalyzing && (
              <div style={{ position: "absolute", inset: 0, background: `${C.bg}f2`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 10, gap: 12 }}>
                <div style={{ width: 36, height: 36, border: `2px solid ${C.border}`, borderTopColor: C.amber, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: C.amber, textTransform: "uppercase", letterSpacing: "0.15em" }}>Calculating gradients...</span>
              </div>
            )}
            {selectedCase ? (
              <>
                <img src={selectedCase.image_path} alt="Lesion" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 10 }} />
                <img src={selectedCase.heatmap_path} alt="Grad-CAM" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", borderRadius: 10, opacity: gradCamAlpha, mixBlendMode: "screen", pointerEvents: "none", transition: "opacity 0.1s" }} />
                {[["top","left"],["top","right"],["bottom","left"],["bottom","right"]].map(([v,h]) => (
                  <div key={`${v}${h}`} style={{ position: "absolute", [v]: 8, [h]: 8, width: 10, height: 10, borderTop: v === "top" ? `1px solid ${C.border}` : "none", borderBottom: v === "bottom" ? `1px solid ${C.border}` : "none", borderLeft: h === "left" ? `1px solid ${C.border}` : "none", borderRight: h === "right" ? `1px solid ${C.border}` : "none", pointerEvents: "none" }} />
                ))}
              </>
            ) : (
              <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: C.textMuted }}>Select a case to view scan</p>
            )}
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", background: C.bg }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: C.textMuted, textTransform: "uppercase" }}>Photo</span>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: C.amber, fontWeight: 700 }}>Grad-CAM {Math.round(gradCamAlpha * 100)}%</span>
            </div>
            <input type="range" min={0} max={1} step={0.01} value={gradCamAlpha} onChange={e => setGradCamAlpha(parseFloat(e.target.value))} style={{ width: "100%", accentColor: C.amber, cursor: "pointer" }} />
          </div>
          {selectedCase && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: C.textMuted }}>{selectedCase.predicted_class}</span>
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: C.amber, fontWeight: 700 }}>{selectedCase.confidence_score?.toFixed(1)}%</span>
              </div>
              <div style={{ height: 3, background: C.border, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 4, width: `${selectedCase.confidence_score}%`, background: C.amber, transition: "width 0.5s" }} />
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — Pathology Reporter */}
        <div ref={reportRef} style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, display: "flex", flexDirection: "column", minHeight: 0, padding: 18, gap: 14 }}>
          <div>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: C.amber, textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 4 }}>Pathology Reporter</p>
            <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 300, fontSize: 11, color: C.textMuted }}>AI-generated diagnostic documentation</p>
          </div>
          <div style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, overflowY: "auto", fontSize: 11, lineHeight: 1.7, position: "relative" }}>
            {isGenerating && (
              <div style={{ position: "absolute", inset: 0, background: `${C.bg}f2`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 10 }}>
                <div style={{ width: 26, height: 26, border: `2px solid ${C.border}`, borderTopColor: C.amber, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: C.amber, textTransform: "uppercase", letterSpacing: "0.15em" }}>Generating...</span>
              </div>
            )}
            {report ? (
              <div>
                <div style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 8, marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: C.textMuted }}>CASE: {selectedCase?.case_id}</span>
                  <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: C.textMuted }}>GRADIA DRAFT</span>
                </div>
                {report.split("\n").map((line, i) => {
                  if (line.startsWith("## ")) return <h3 key={i} style={{ fontFamily: "'Outfit', sans-serif", color: C.text, fontSize: 11, fontWeight: 700, borderLeft: `2px solid ${C.amber}`, paddingLeft: 8, margin: "16px 0 6px", textTransform: "uppercase", letterSpacing: "0.1em" }}>{line.replace("## ", "")}</h3>;
                  if (line.startsWith("### ")) return <h4 key={i} style={{ fontFamily: "'Outfit', sans-serif", color: C.amber, fontSize: 10, fontWeight: 700, margin: "10px 0 4px" }}>{line.replace("### ", "")}</h4>;
                  return <p key={i} style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 300, color: C.textDim, marginBottom: 4 }}>{line}</p>;
                })}
              </div>
            ) : reportError ? (
              <p style={{ fontFamily: "'Outfit', sans-serif", color: C.danger, fontSize: 12 }}>{reportError}</p>
            ) : (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <span style={{ fontSize: 22, opacity: 0.3 }}>◈</span>
                <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: C.textMuted, textAlign: "center", textTransform: "uppercase", letterSpacing: "0.1em" }}>Select a case and generate report</p>
              </div>
            )}
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
            <Btn full disabled={!selectedCase || isGenerating} onClick={() => selectedCase && generateReport(selectedCase.case_id)}>
              {isGenerating ? "Processing..." : "Generate Report"}
            </Btn>
            <Btn full variant="ghost" disabled={!report || exportingPdf} onClick={handleExportPdf}>
              {exportingPdf ? "Exporting..." : "Download PDF Report"}
            </Btn>
          </div>
        </div>
      </div>
      <Footer page={page} caseId={selectedCase?.case_id} />
      <GS />
    </div>
  );
}

function Footer({ page, caseId }: { page: string; caseId?: string }) {
  return (
    <footer style={{ padding: "12px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "'Space Mono', monospace", fontSize: 9, color: C.textMuted }}>
      <span>{page.toUpperCase()} // {caseId || "NO CASE"}</span>
      <span style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>GRADIA.AI — Research Platform. Not for clinical use.</span>
    </footer>
  );
}

function GS() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Outfit:wght@300;400;600;700&family=Space+Mono:wght@400;700&display=swap');
      *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
      html, body, #root { height: 100%; }
      body { background: #0a0a0b; }
      @keyframes spin    { to { transform: rotate(360deg); } }
      @keyframes pulse   { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
      @keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      ::-webkit-scrollbar { width: 3px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #1e1e1f; border-radius: 4px; }
    `}</style>
  );
}