# GRADIA.AI

<img src="https://img.shields.io/badge/GRADIA.AI-Dermoscopy%20Analysis-f59e0b?style=for-the-badge&logoColor=black" />
<img src="https://img.shields.io/badge/ResNet--50-85.2%25%20Test%20Accuracy-f59e0b?style=for-the-badge&logo=pytorch&logoColor=white" />
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

AI-powered dermoscopy analysis platform. Upload a skin lesion image to classify it into one of the 7 HAM10000 lesion categories, see a Grad-CAM map of the regions that drove the prediction, and generate a Gemini-drafted pathology report.

> **Research and educational platform only. Not intended for clinical diagnosis.**

## Overview

GRADIA.AI is a full-stack platform for explainable skin lesion analysis. A ResNet-50 fine-tuned on HAM10000 classifies the image, Grad-CAM shows where the model reacted, and a multimodal Gemini call drafts a structured report that can be exported as a PDF.

The model is trained and evaluated with a **lesion-level split** and a **held-out test set**, and results are reported per class with 95% confidence ranges, not as a single accuracy number. See [Model performance](#model-performance) and [Why the accuracy changed](#why-the-accuracy-changed-from-8867).

## Features

- **Lesion classification:** ResNet-50 fine-tuned on HAM10000. **85.2% test accuracy** on unseen lesions (balanced accuracy 0.688, macro-F1 0.715).
- **Grad-CAM explainability:** heatmap from the last ResNet block, aligned to the exact 224 × 224 region the model sees.
- **Clinical report drafts:** multimodal Gemini call using the image and case details. Patient name and reference are removed before anything is sent.
- **PDF export:** original image, Grad-CAM overlay, case summary and the full report.
- **Case management:** searchable case list per clinician, with severity tags and delete.
- **Authentication:** Firebase Auth (email/password and Google). Every API call is verified server-side.
- **Cloud storage:** images and heatmaps stored in Cloudflare R2, with a local fallback.
- **Upload validation:** JPEG, PNG or WebP up to 10 MB, checked before inference.

## Supported lesion categories

| Code | Diagnosis | Risk level shown in the app |
|---|---|---|
| MEL | Melanoma | High Risk (Moderate if model score ≤ 70%) |
| BCC | Basal Cell Carcinoma | High Risk (Moderate if model score ≤ 70%) |
| AKIEC | Actinic Keratosis / Intraepithelial Carcinoma | High Risk (Moderate if model score ≤ 70%) |
| BKL | Benign Keratosis | Low Risk |
| DF | Dermatofibroma | Low Risk |
| NV | Melanocytic Nevus | Benign / Safe |
| VASC | Vascular Lesion | Benign / Safe |

Risk levels come from `classify_severity()` in `gradia-backend/main.py`. They are a simple rule on the predicted class and score, not a clinical risk assessment.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| Backend | FastAPI (Python) |
| ML model | PyTorch: ResNet-50 (ImageNet-pretrained), fully fine-tuned on HAM10000 |
| Explainability | Grad-CAM (hooks on `layer4[-1]`) |
| Auth | Firebase Authentication + Firebase Admin token verification |
| Database | PostgreSQL via SQLAlchemy (hosted on Supabase) |
| Storage | Cloudflare R2 (S3 API via boto3) |
| AI reports | Google Gemini (model set by `GEMINI_MODEL`, default `gemini-3.5-flash`) |
| PDF export | jsPDF |

## Model performance

Evaluated **once** on a held-out test set of **1,431 images from 1,067 lesions** that never appeared in training or validation. Probabilities are calibrated with temperature scaling. 95% ranges come from a lesion-level bootstrap (1,000 resamples).

### Headline metrics (single view, as served by the app)

| Metric | Test result | 95% range |
|---|---|---|
| Accuracy | **85.2%** | 82.8 – 87.4% |
| Always-"nevus" baseline | 67.0% | |
| Balanced accuracy | **0.688** | 0.626 – 0.757 |
| Macro-F1 | **0.715** | 0.641 – 0.772 |
| Melanoma recall (sensitivity) | **0.566** | 0.473 – 0.667 |
| Melanoma specificity | 0.962 | |
| Macro ROC-AUC / PR-AUC | 0.906 / 0.723 | |
| Top-2 / top-3 accuracy | 91.3% / 93.2% | |
| Cohen's kappa / MCC | 0.707 / 0.709 | |
| Weighted F1 | 0.847 | |
| Log loss | 0.642 | |
| Brier score / probability RMSE | 0.246 / 0.188 | |
| Pseudo-R² (McFadden) | 0.432 | |
| Expected calibration error (ECE) | 0.059 | |

With **test-time augmentation** (8 rotations/flips averaged), accuracy rises to 86.0%, macro-F1 to 0.728 and melanoma recall to 0.579. The app currently serves single-view predictions.

### Per-class results (test set)

| Class | Precision | Recall | Specificity | F1 | ROC-AUC | Test images |
|---|---|---|---|---|---|---|
| AKIEC | 0.571 | 0.696 | 0.983 | 0.627 | 0.835 | 46 |
| BCC | 0.723 | 0.811 | 0.983 | 0.764 | 0.983 | 74 |
| BKL | 0.797 | 0.624 | 0.980 | 0.700 | 0.892 | 157 |
| DF | 0.778 | 0.412 | 0.999 | 0.538 | 0.833 | 17 |
| MEL | 0.647 | 0.566 | 0.961 | 0.604 | 0.901 | 159 |
| NV | 0.912 | 0.957 | 0.814 | 0.934 | 0.932 | 958 |
| VASC | 0.938 | 0.750 | 0.999 | 0.833 | 0.963 | 20 |

Most missed melanomas were predicted as nevus (49 of 69). DF and VASC have very few test images, so their numbers are unstable.

### Confidence

The calibrated score is useful for flagging uncertain cases: answering only when confidence is at least 70% covers 89.5% of test images at 89.5% accuracy.

### Why the accuracy changed from 88.67%

The first version of this project reported **88.67% validation accuracy**. Exploratory analysis showed that number was inflated:

- HAM10000 has 10,015 images of only **7,470 lesions**: 26% of lesions have more than one photo.
- The original split was by **image**, so **39.5% of validation images** had a photo of the same lesion in the training set (up to 69% for melanoma).
- The same validation set chose the best epoch and was then reported as the result.

The current pipeline splits by **lesion**, keeps a separate **test set**, and selects the best epoch by **macro-F1** on validation. The resulting 85.2% is lower, but it measures performance on lesions the model has never seen.

## Training pipeline

Three notebooks in the repository root, run in order:

| Notebook | What it does |
|---|---|
| `EDA.ipynb` | Data quality, class balance, lesion structure and leakage check, `dx_type` analysis, age/sex/site by class, image statistics, near-duplicate search |
| `PREPROCESS.ipynb` | Verifies every image, cleans metadata, fixes the label order, makes the lesion-grouped split, computes train-only statistics, saves resized images |
| `TRAIN.ipynb` | Trains, calibrates and evaluates on the test set; saves weights, metrics and figures |

### Data preparation (`PREPROCESS.ipynb`)

- All 10,015 images verified readable; nothing removed.
- **Missing values:** 96 ages missing (57 blank + 39 recorded as 0) are filled with the **training-set** median (50) and flagged; `unknown` sex (57) and body site (234) are kept as their own category.
- `acral` (7 images) merged into `foot`.
- `dx_type` kept for analysis only: it encodes how a diagnosis was confirmed (e.g. `follow_up` occurs only for nevi) and would leak the label.
- **Split by `lesion_id`** with `StratifiedGroupKFold`: 7,153 train / 1,431 validation / 1,431 test images, every class in every split, no lesion in two splits.
- Label order fixed alphabetically (`AKIEC, BCC, BKL, DF, MEL, NV, VASC`) and saved to `classes.json`.

### Training configuration (`TRAIN.ipynb`)

| Setting | Value |
|---|---|
| Architecture | ResNet-50, ImageNet weights (`IMAGENET1K_V2`), all layers fine-tuned, final layer → 7 classes |
| Input | Resize short side to 256, crop 224 (random for training, centre for evaluation), ImageNet normalisation |
| Augmentation | Random 90° rotations, horizontal flips, random crop, mild colour jitter |
| Loss | Cross-entropy with `1/√count` class weights and label smoothing 0.1 |
| Optimiser | AdamW: lr 1e-4 (backbone), 1e-3 (head), weight decay 1e-4 |
| Schedule | 1-epoch warm-up, then cosine decay (per step) |
| Weights averaging | EMA (decay 0.999); the EMA copy is evaluated and saved |
| Epochs | 30 (early stopping patience 10); best epoch 27 by validation macro-F1 |
| Batch size | 32, mixed precision |
| Calibration | Temperature scaling on validation (T = 0.69) |
| Hardware | NVIDIA RTX 3050 Laptop GPU (4 GB), about 27 minutes |

Outputs (`resnet50_ham10000.pth`, `classes.json`, `calibration.json`, `metrics.json`, curves, confusion matrix, calibration and Grad-CAM figures) are written to `runs/<experiment>/` inside the data folder.

## Project structure

```
Gradia.AI/
├── EDA.ipynb                # Exploratory data analysis
├── PREPROCESS.ipynb         # Cleaning, label order, lesion-level split
├── TRAIN.ipynb              # Training, calibration, test evaluation
│
├── gradia-backend/
│   ├── main.py              # FastAPI routes, auth, storage, Gemini, case management
│   ├── inference.py         # Model loading, prediction, Grad-CAM
│   ├── requirements.txt
│   ├── weights/             # Not tracked in git
│   │   ├── resnet50_ham10000.pth
│   │   ├── classes.json
│   │   └── calibration.json
│   ├── uploads/             # Local image fallback
│   └── .env                 # Not tracked
│
├── gradia-frontend/
│   ├── src/
│   │   ├── App.tsx          # Landing, sign-in, new scan, case workspace, PDF export
│   │   ├── firebase.ts      # Firebase client config
│   │   └── api/
│   │       ├── gradiaApi.ts # API client (fresh Firebase token per request)
│   │       └── hooks.ts     # React hooks: auth, cases, upload, report
│   └── .env                 # Not tracked
│
└── .gitignore
```

## Getting started

### Prerequisites

- Python 3.10+
- Node.js 18+
- PostgreSQL database (e.g. Supabase)
- Firebase project
- Cloudflare R2 bucket
- Google Gemini API key
- Optional: NVIDIA GPU for training (inference also runs on CPU)

### Backend

```bash
cd gradia-backend
python -m venv venv
venv\Scripts\activate          # Windows
source venv/bin/activate       # Mac/Linux

pip install -r requirements.txt
```

For GPU support, install the CUDA build of PyTorch from [pytorch.org](https://pytorch.org/get-started/locally/); plain `pip install torch` installs the CPU build on Windows.

Create `gradia-backend/.env`:

```
DATABASE_URL=postgresql://...
FIREBASE_SERVICE_ACCOUNT_PATH=firebase-service-account.json
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-3.5-flash
R2_ENDPOINT_URL=https://accountid.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your_key
R2_SECRET_ACCESS_KEY=your_secret
R2_BUCKET_NAME=gradia-images
R2_PUBLIC_URL=https://pub-xxx.r2.dev
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:8000
```

Place the Firebase service account JSON as `gradia-backend/firebase-service-account.json`, and the trained files in `gradia-backend/weights/` (see the training pipeline above).

```bash
python -m uvicorn main:app --reload
```

The model loads at startup. If the weights are missing, the server refuses to start rather than serving untrained predictions (set `ALLOW_UNTRAINED_MODEL=1` to test the UI without weights). `GET /health` reports whether trained weights are loaded.

Backend: `http://localhost:8000` · API docs: `http://localhost:8000/docs`

### Frontend

```bash
cd gradia-frontend
npm install
```

Create `gradia-frontend/.env`:

```
VITE_API_URL=http://localhost:8000
VITE_FIREBASE_API_KEY=your_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
```

```bash
npm run dev
```

Frontend: `http://localhost:5173`

### Training the model

1. Download HAM10000 (images and `HAM10000_metadata.csv`) from Kaggle.
2. Set the dataset paths in the first code cell of each notebook (Windows paths and Colab are both supported).
3. Run `EDA.ipynb`, then `PREPROCESS.ipynb`, then `TRAIN.ipynb`.
4. Copy `resnet50_ham10000.pth`, `classes.json` and `calibration.json` from `runs/image/` into `gradia-backend/weights/`.

## API endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check, including whether trained weights are loaded |
| GET | `/auth/me` | Current clinician (created on first sign-in) |
| PATCH | `/auth/me` | Update the clinician's name |
| GET | `/api/cases` | List the clinician's cases (paginated, searchable) |
| POST | `/api/cases/upload` | Validate upload, run inference and Grad-CAM, store the case |
| GET | `/api/cases/{id}` | Get one case (only if owned by the clinician) |
| DELETE | `/api/cases/{id}` | Delete a case and its stored images |
| POST | `/api/cases/{id}/report` | Generate a Gemini report draft |

## Known limitations

- **Melanoma recall is 0.57**: roughly 4 in 10 test melanomas are missed, mostly predicted as nevus.
- **One dataset.** HAM10000 comes from two clinics and mostly lighter skin; performance on other populations and cameras is unknown.
- **Small classes** (DF, VASC) have under 25 test images each, so their metrics carry wide uncertainty.
- **Grad-CAM is approximate**: a 7 × 7 map showing where the model reacted, not what is medically important.
- The backend does not yet apply the calibration temperature, test-time augmentation, or a melanoma alert threshold.
- Stored images are served from public R2 URLs.
- No automated test suite yet.

## Roadmap

- [ ] Metadata fusion experiment (image + age, sex, body site), compared on the same split
- [ ] Melanoma decision threshold tuned on validation for a target recall
- [ ] Higher-resolution training (e.g. 320 px)
- [ ] Backend: calibrated scores, top-3 classes, melanoma alert, optional test-time augmentation
- [ ] Private image URLs (presigned R2 links)
- [ ] Automated tests and deployment

## Disclaimer

GRADIA.AI is an educational and research platform. All classifications and generated reports are AI-produced drafts and must be reviewed by a certified dermatologist before any clinical decision is made. This platform is not approved for medical diagnosis.

## License

MIT
