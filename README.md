# GRADIA.AI

<img src="https://img.shields.io/badge/GRADIA.AI-Dermoscopy%20Analysis-f59e0b?style=for-the-badge&logoColor=black" />
<img src="https://img.shields.io/badge/ResNet--50-88.67%25%20Accuracy-f59e0b?style=for-the-badge&logo=pytorch&logoColor=white" />
<img src="https://img.shields.io/badge/HAM10000-10%2C015%20Images-orange?style=for-the-badge" />
<img src="https://img.shields.io/badge/FastAPI-Backend-009688?style=for-the-badge&logo=fastapi&logoColor=white" />
<img src="https://img.shields.io/badge/React-Frontend-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
<img src="https://img.shields.io/badge/PyTorch-Inference-EE4C2C?style=for-the-badge&logo=pytorch&logoColor=white" />
<img src="https://img.shields.io/badge/Firebase-Auth-FFCA28?style=for-the-badge&logo=firebase&logoColor=black" />
<img src="https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" />
<img src="https://img.shields.io/badge/Cloudflare-R2%20Storage-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" />
<img src="https://img.shields.io/badge/Gemini-AI%20Reports-4285F4?style=for-the-badge&logo=google&logoColor=white" />
<img src="https://img.shields.io/badge/Grad--CAM-Explainability-purple?style=for-the-badge" />
<img src="https://img.shields.io/badge/PDF-Export-red?style=for-the-badge" />
<img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" />

**AI-powered dermoscopy analysis platform.** Upload skin lesion images for instant classification across 7 HAM10000 lesion categories, Grad-CAM explainability maps, and Gemini-generated clinical pathology drafts.

> Research platform only. Not intended for clinical diagnosis.

---

## Overview

GRADIA.AI is a full-stack medical AI platform built for explainable skin lesion analysis. It combines a fine-tuned ResNet-50 classifier trained on the HAM10000 dataset with Gradient-weighted Class Activation Mapping (Grad-CAM) to produce both a classification result and a visual explanation of which regions of the dermoscopy image drove the model's decision.

A multimodal Gemini API integration generates structured clinical pathology reports from the image and patient metadata, which can be exported as a formatted PDF.

---

## Features

- **Lesion Classification** — ResNet-50 fine-tuned on HAM10000, achieving 88.67% validation accuracy across 7 skin lesion categories
- **Grad-CAM Explainability** — Real-time activation heatmap overlay showing which pixels influenced the classification
- **Clinical Report Generation** — Multimodal Gemini API generates structured pathology drafts from image + patient metadata
- **PDF Export** — Downloadable clinical report including original image, Grad-CAM overlay, case summary, and full report
- **Case Management** — Searchable patient case explorer with severity tagging, stored in Supabase
- **Secure Authentication** — Firebase Auth with email/password and Google sign-in
- **Cloud Storage** — Dermoscopy images and heatmaps stored in Cloudflare R2

---

## Supported Lesion Categories

| Code | Diagnosis | Risk Level |
|------|-----------|------------|
| MEL | Melanoma | High Risk |
| BCC | Basal Cell Carcinoma | High Risk |
| AKIEC | Actinic Keratosis / Intraepithelial Carcinoma | Moderate Risk |
| BKL | Benign Keratosis | Low Risk |
| DF | Dermatofibroma | Low Risk |
| NV | Melanocytic Nevus | Benign / Safe |
| VASC | Vascular Lesion | Benign / Safe |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| Backend | FastAPI (Python) |
| ML Model | PyTorch — ResNet-50 fine-tuned on HAM10000 |
| Explainability | Grad-CAM (layer4 hooks) |
| Auth | Firebase Authentication |
| Database | Supabase (PostgreSQL) |
| Storage | Cloudflare R2 |
| AI Reports | Google Gemini 1.5 Flash |
| PDF Export | jsPDF + html2canvas |

---

## Model Performance

| Metric | Value |
|--------|-------|
| Architecture | ResNet-50 |
| Dataset | HAM10000 (10,015 images) |
| Training Epochs | 20 |
| Best Validation Accuracy | **88.67%** |
| Device | NVIDIA T4 (Google Colab) |
| Class Weighting | Inverse frequency (handles imbalance) |

---

## Project Structure

```
Gradia.AI/
├── gradia-backend/
│   ├── main.py              # FastAPI routes, auth, case management
│   ├── inference.py         # ResNet-50 inference + Grad-CAM engine
│   ├── train.py             # HAM10000 fine-tuning script
│   ├── weights/             # Model weights (not tracked in git)
│   ├── uploads/             # Local image fallback
│   └── .env                 # Environment variables (not tracked)
│
├── gradia-frontend/
│   ├── src/
│   │   ├── App.tsx          # Main application (4 pages)
│   │   ├── firebase.ts      # Firebase config
│   │   └── api/
│   │       ├── gradiaApi.ts # API client
│   │       └── hooks.ts     # React hooks (auth, cases, upload, report)
│   └── .env                 # Frontend env variables (not tracked)
│
└── .gitignore
```

---

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- Supabase project
- Firebase project
- Cloudflare R2 bucket
- Google Gemini API key

### Backend Setup

```bash
cd gradia-backend
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate     # Mac/Linux

pip install fastapi uvicorn sqlalchemy psycopg2-binary firebase-admin \
            torch torchvision Pillow opencv-python-headless numpy \
            pydantic[email] python-dotenv boto3 httpx python-multipart
```

Create `.env` in `gradia-backend/`:

```env
DATABASE_URL=postgresql://...
FIREBASE_SERVICE_ACCOUNT_PATH=firebase-service-account.json
GEMINI_API_KEY=your_key
R2_ENDPOINT_URL=https://accountid.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your_key
R2_SECRET_ACCESS_KEY=your_secret
R2_BUCKET_NAME=gradia-images
R2_PUBLIC_URL=https://pub-xxx.r2.dev
FRONTEND_URL=http://localhost:5173
```

Place your Firebase service account JSON as `firebase-service-account.json` in `gradia-backend/`.

Place your trained model weights at `gradia-backend/weights/resnet50_ham10000.pth`.

```bash
uvicorn main:app --reload
```

Backend runs at `http://localhost:8000`. API docs at `http://localhost:8000/docs`.

### Frontend Setup

```bash
cd gradia-frontend
npm install
```

Create `.env` in `gradia-frontend/`:

```env
VITE_API_URL=http://localhost:8000
VITE_FIREBASE_API_KEY=your_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
```

```bash
npm run dev
```

Frontend runs at `http://localhost:5173`.

### Training the Model

Download the [HAM10000 dataset](https://www.kaggle.com/datasets/kmader/skin-lesion-analysis-toward-melanoma-detection) from Kaggle.

Upload to Google Colab and run `train.py` on a T4 GPU. Training takes approximately 1.5–2 hours for 20 epochs.

```bash
python train.py
```

Download the output `resnet50_ham10000.pth` and place it in `gradia-backend/weights/`.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/auth/me` | Get current clinician |
| GET | `/api/cases` | List cases (paginated, searchable) |
| POST | `/api/cases/upload` | Upload scan + run inference |
| GET | `/api/cases/{id}` | Get single case |
| DELETE | `/api/cases/{id}` | Delete case |
| POST | `/api/cases/{id}/report` | Generate Gemini pathology report |

---

## Disclaimer

GRADIA.AI is an educational and research platform. All classifications and generated reports are AI-produced drafts and must be reviewed and verified by a certified dermatologist before any clinical decision is made. This platform is not approved for medical diagnosis.

---

## License

MIT
