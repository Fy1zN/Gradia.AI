"""
GRADIA.AI — Production FastAPI Backend
Stack: FastAPI + Supabase (PostgreSQL) + Firebase Auth + Cloudflare R2 + Gemini API
"""

import os
import uuid
import boto3
import httpx
import base64
from datetime import datetime
from typing import Optional, List
from pathlib import Path

import firebase_admin
from firebase_admin import auth, credentials

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from sqlalchemy import create_engine, Column, String, Integer, Float, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, sessionmaker, Session, relationship

from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

#Environment config

DATABASE_URL         = os.getenv("DATABASE_URL")
GEMINI_API_KEY       = os.getenv("GEMINI_API_KEY")
GEMINI_URL           = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
FRONTEND_URL         = os.getenv("FRONTEND_URL", "http://localhost:5173")

R2_ENDPOINT_URL      = os.getenv("R2_ENDPOINT_URL")
R2_ACCESS_KEY_ID     = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME       = os.getenv("R2_BUCKET_NAME", "gradia-images")
R2_PUBLIC_URL        = os.getenv("R2_PUBLIC_URL")

FIREBASE_SA_PATH     = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "firebase-service-account.json")

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# Firebase initialization

cred = credentials.Certificate(FIREBASE_SA_PATH)
firebase_admin.initialize_app(cred)

# DB setup

engine       = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base         = declarative_base()


class Clinician(Base):
    __tablename__ = "clinicians"

    clinician_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    firebase_uid = Column(String(128), unique=True, nullable=False, index=True)
    name         = Column(String(120), nullable=True)
    email        = Column(String(200), unique=True, nullable=False, index=True)
    created_at   = Column(DateTime, default=datetime.utcnow)

    cases = relationship("PatientCase", back_populates="clinician", cascade="all, delete-orphan")


class PatientCase(Base):
    __tablename__ = "patient_cases"

    case_id          = Column(String(20), primary_key=True)
    lesion_id        = Column(String(50), unique=True, nullable=False)
    clinician_id     = Column(UUID(as_uuid=True), ForeignKey("clinicians.clinician_id"), nullable=False)
    age              = Column(Integer, nullable=False)
    sex              = Column(String(20), nullable=False)
    localization     = Column(String(100), nullable=False)
    clinical_notes   = Column(Text, nullable=True)
    image_path       = Column(String(500), nullable=False)
    predicted_class  = Column(String(100), nullable=True)
    confidence_score = Column(Float, nullable=True)
    heatmap_path     = Column(String(500), nullable=True)
    severity         = Column(String(50), nullable=True)
    description      = Column(Text, nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)

    clinician = relationship("Clinician", back_populates="cases")


Base.metadata.create_all(bind=engine)

# Cloudflare R2 client 

r2_client = boto3.client(
    "s3",
    endpoint_url=R2_ENDPOINT_URL,
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    region_name="auto"
)


def upload_to_r2(file_bytes: bytes, key: str, content_type: str = "image/jpeg") -> str:
    try:
        r2_client.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=key,
            Body=file_bytes,
            ContentType=content_type,
        )
        return f"{R2_PUBLIC_URL}/{key}"
    except Exception as e:
        print(f"[GRADIA] R2 upload failed: {e} — falling back to local storage")
        return save_locally(file_bytes, key.replace("/", "_"))


def save_locally(file_bytes: bytes, filename: str) -> str:
    safe_name = filename.replace("/", "_")
    path = UPLOAD_DIR / safe_name
    path.write_bytes(file_bytes)
    return f"/static/{safe_name}"


def get_file_bytes_from_path(file_path: str) -> bytes:
    if file_path.startswith("/static/"):
        filename = file_path.replace("/static/", "")
        return (UPLOAD_DIR / filename).read_bytes()
    else:
        # Extract key from public URL
        key = "/".join(file_path.split("/")[3:])
        obj = r2_client.get_object(Bucket=R2_BUCKET_NAME, Key=key)
        return obj["Body"].read()

# Auth utilities 

bearer = HTTPBearer()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_clinician(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db)
) -> Clinician:
    token = credentials.credentials
    try:
        decoded = auth.verify_id_token(token)
        uid     = decoded["uid"]
        email   = decoded.get("email", "")
        name    = decoded.get("name", "")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired Firebase token")

    clinician = db.query(Clinician).filter(Clinician.firebase_uid == uid).first()
    if not clinician:
        clinician = Clinician(firebase_uid=uid, email=email, name=name)
        db.add(clinician)
        db.commit()
        db.refresh(clinician)

    return clinician

# Pydantic schemas 

class ClinicianResponse(BaseModel):
    clinician_id: str
    firebase_uid: str
    name:         Optional[str]
    email:        str
    created_at:   datetime

    class Config:
        from_attributes = True


class CaseResponse(BaseModel):
    case_id:          str
    lesion_id:        str
    age:              int
    sex:              str
    localization:     str
    clinical_notes:   Optional[str]
    image_path:       str
    predicted_class:  Optional[str]
    confidence_score: Optional[float]
    heatmap_path:     Optional[str]
    severity:         Optional[str]
    description:      Optional[str]
    created_at:       datetime

    class Config:
        from_attributes = True


class CaseListResponse(BaseModel):
    cases:     List[CaseResponse]
    total:     int
    page:      int
    page_size: int

#  Inference engine

_inference_engine = None

def get_inference_engine():
    global _inference_engine
    if _inference_engine is None:
        from inference import GradiaInference
        _inference_engine = GradiaInference()
    return _inference_engine

# Severity classifier

HAM_HIGH_RISK     = {"MEL", "BCC", "SCC", "AKIEC"}
HAM_MODERATE_RISK = {"BKL", "DF"}

def classify_severity(predicted_class: str, confidence: float) -> str:
    code = predicted_class.split("(")[-1].replace(")", "").strip().upper()
    if code in HAM_HIGH_RISK:
        return "High Risk" if confidence > 70 else "Moderate Risk"
    if code in HAM_MODERATE_RISK:
        return "Low Risk"
    return "Benign / Safe"

#  FastAPI app 

app = FastAPI(
    title="GRADIA.AI API",
    version="1.0.0",
    description="Production backend for GRADIA.AI — Explainable AI Dermascope Terminal"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000", "http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="uploads"), name="static")

#  Health check 

@app.get("/health")
def health():
    return {
        "status":  "online",
        "project": "GRADIA.AI",
        "version": "1.0.0",
        "model":   "ResNet-50 HAM10000"
    }

#  Auth routes 

@app.get("/auth/me", response_model=ClinicianResponse)
def get_me(clinician: Clinician = Depends(get_current_clinician)):
    return {
        "clinician_id": str(clinician.clinician_id),
        "firebase_uid": clinician.firebase_uid,
        "name":         clinician.name,
        "email":        clinician.email,
        "created_at":   clinician.created_at
    }


@app.patch("/auth/me")
def update_profile(
    name: str,
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician)
):
    clinician.name = name
    db.commit()
    db.refresh(clinician)
    return {"message": "Profile updated", "name": clinician.name}

#  Case routes 

@app.get("/api/cases", response_model=CaseListResponse)
def get_cases(
    search:    Optional[str] = None,
    page:      int = 1,
    page_size: int = 20,
    db:        Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician)
):
    query = db.query(PatientCase).filter(
        PatientCase.clinician_id == clinician.clinician_id
    )
    if search:
        like = f"%{search}%"
        query = query.filter(
            PatientCase.case_id.ilike(like) |
            PatientCase.predicted_class.ilike(like) |
            PatientCase.localization.ilike(like)
        )
    total = query.count()
    cases = query.order_by(PatientCase.created_at.desc()) \
                 .offset((page - 1) * page_size) \
                 .limit(page_size).all()
    return CaseListResponse(cases=cases, total=total, page=page, page_size=page_size)


@app.get("/api/cases/{case_id}", response_model=CaseResponse)
def get_case(
    case_id:   str,
    db:        Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician)
):
    case = db.query(PatientCase).filter(
        PatientCase.case_id == case_id,
        PatientCase.clinician_id == clinician.clinician_id
    ).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@app.post("/api/cases/upload", response_model=CaseResponse, status_code=201)
async def upload_case(
    age:            int           = Form(...),
    sex:            str           = Form(...),
    localization:   str           = Form(...),
    clinical_notes: Optional[str] = Form(None),
    image:          UploadFile    = File(...),
    db:             Session       = Depends(get_db),
    clinician:      Clinician     = Depends(get_current_clinician)
):
    image_bytes = await image.read()

    case_id   = f"GR-{uuid.uuid4().hex[:6].upper()}"
    lesion_id = f"GRD_{uuid.uuid4().hex[:10].upper()}"

    img_key   = f"cases/{case_id}/original.jpg"
    image_url = upload_to_r2(image_bytes, img_key, image.content_type or "image/jpeg")

    engine      = get_inference_engine()
    prediction  = engine.predict(image_bytes)
    heatmap_png = engine.generate_gradcam_png(image_bytes, prediction["class_idx"])

    hm_key      = f"cases/{case_id}/heatmap.png"
    heatmap_url = upload_to_r2(heatmap_png, hm_key, "image/png")

    severity = classify_severity(prediction["predicted_class"], prediction["confidence"])

    case = PatientCase(
        case_id=case_id,
        lesion_id=lesion_id,
        clinician_id=clinician.clinician_id,
        age=age,
        sex=sex,
        localization=localization,
        clinical_notes=clinical_notes,
        image_path=image_url,
        predicted_class=prediction["predicted_class"],
        confidence_score=prediction["confidence"],
        heatmap_path=heatmap_url,
        severity=severity,
        description=prediction.get("description", "")
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


@app.delete("/api/cases/{case_id}", status_code=204)
def delete_case(
    case_id:   str,
    db:        Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician)
):
    case = db.query(PatientCase).filter(
        PatientCase.case_id == case_id,
        PatientCase.clinician_id == clinician.clinician_id
    ).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    db.delete(case)
    db.commit()
    return

#  Gemini pathology report 

@app.post("/api/cases/{case_id}/report")
async def generate_report(
    case_id:   str,
    db:        Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician)
):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    case = db.query(PatientCase).filter(
        PatientCase.case_id == case_id,
        PatientCase.clinician_id == clinician.clinician_id
    ).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    try:
        img_bytes = get_file_bytes_from_path(case.image_path)
        img_b64   = base64.b64encode(img_bytes).decode("utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load case image: {e}")

    system_prompt = (
        "You are a clinical AI agent and dermatopathology specialist operating within GRADIA.AI. "
        "Your task is to produce a formal, highly detailed dermatological pathology report. "
        "Tone must be objective, professional, and academic. "
        "Always use Markdown with clear section headers. "
        "End with a mandatory disclaimer stating this is an AI-generated draft "
        "that must be reviewed and verified by a certified dermatologist before any clinical decision."
    )

    user_prompt = f"""
Draft a complete Dermatological Pathology Report for the following case:

**Case Reference:** {case.case_id}
**Patient Demographics:** {case.age}-year-old {case.sex}
**Lesion Localization:** {case.localization}
**AI Classification:** {case.predicted_class}
**Confidence Score:** {case.confidence_score:.1f}%
**Severity Assessment:** {case.severity}
**Clinical Notes:** {case.clinical_notes or 'None provided'}
**Morphological Summary:** {case.description}

The attached image is the original dermoscopy photograph processed by the GRADIA.AI ResNet-50 classifier.

Provide detailed structured sections for:
## 1. CLINICAL PREAMBLE & CASE VERIFICATION
## 2. MORPHOLOGICAL PHENOTYPE ANALYSIS
## 3. BIOPHYSICAL CRITERIA COMPLIANCE (ABCD dermoscopy criteria)
## 4. DIFFERENTIAL DIAGNOSIS CONSIDERATIONS
## 5. STRATEGIC CARE RECOMMENDATIONS & TRIAGE SEQUENCE
## DISCLAIMER
"""

    payload = {
        "contents": [{
            "parts": [
                {"inline_data": {"mime_type": "image/jpeg", "data": img_b64}},
                {"text": user_prompt}
            ]
        }],
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 2048}
    }

    async def stream_gemini():
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                f"{GEMINI_URL}?key={GEMINI_API_KEY}",
                json=payload,
                headers={"Content-Type": "application/json"}
            )
            if not response.is_success:
                yield f"Error: Gemini API returned {response.status_code}"
                return
            data = response.json()
            text = data.get("candidates", [{}])[0] \
                       .get("content", {}) \
                       .get("parts", [{}])[0] \
                       .get("text", "Report generation failed.")
            yield text

    return StreamingResponse(stream_gemini(), media_type="text/plain")