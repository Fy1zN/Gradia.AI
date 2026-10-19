"""
GRADIA.AI — Inference Engine
ResNet-50 classifier + Grad-CAM for HAM10000 skin lesion analysis
"""

import io
import os
import json
import threading
from pathlib import Path
import numpy as np
from typing import Dict, Any

import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import models, transforms
from PIL import Image
import cv2


# HAM10000 class definitions, keyed by diagnosis CODE (not by index).
# The index -> code order MUST match the LabelEncoder used in TRAIN.ipynb.
CLASS_INFO = {
    "AKIEC": {
        "label": "Actinic Keratosis (AKIEC)",
        "severity": "Moderate Risk",
        "description": "Scaly erythematous plaque with surface hyperkeratosis. Precancerous with potential SCC progression."
    },
    "BCC": {
        "label": "Basal Cell Carcinoma (BCC)",
        "severity": "High Risk",
        "description": "Pearly translucent nodule with telangiectasia and slight central ulceration pattern."
    },
    "BKL": {
        "label": "Benign Keratosis (BKL)",
        "severity": "Benign / Safe",
        "description": "Well-demarcated stuck-on appearance with milia-like cysts and comedo-like openings."
    },
    "DF": {
        "label": "Dermatofibroma (DF)",
        "severity": "Benign / Safe",
        "description": "Firm hyperpigmented papule with central white scar-like area and pseudopod-like projections."
    },
    "MEL": {
        "label": "Melanoma (MEL)",
        "severity": "High Risk",
        "description": "Asymmetric border with irregular pigmentation and multi-chromatic dark zones indicating invasive malignant growth."
    },
    "NV": {
        "label": "Melanocytic Nevus (NV)",
        "severity": "Benign / Safe",
        "description": "Symmetric, uniformly pigmented melanocytic lesion with regular borders and no atypical streaks."
    },
    "VASC": {
        "label": "Vascular Lesion (VASC)",
        "severity": "Benign / Safe",
        "description": "Red-to-violet lacunae with well-defined borders and no pigment network, indicating vascular origin."
    },
}

# sklearn's LabelEncoder sorts classes alphabetically, so this is the order
# the trained model uses: 0=AKIEC, 1=BCC, 2=BKL, 3=DF, 4=MEL, 5=NV, 6=VASC
DEFAULT_CLASS_ORDER = ["AKIEC", "BCC", "BKL", "DF", "MEL", "NV", "VASC"]
BASE_DIR = Path(__file__).resolve().parent
CLASSES_PATH = BASE_DIR / "weights" / "classes.json"


def _load_class_order(path: Path = CLASSES_PATH) -> list:
    """Load the index->code order saved by TRAIN.ipynb (le.classes_).
    Falls back to alphabetical order, which is what LabelEncoder produces."""
    if os.path.exists(path):
        with open(path) as f:
            order = [c.upper() for c in json.load(f)]
        print(f"[GRADIA] Loaded class order from {path}: {order}")
    else:
        order = DEFAULT_CLASS_ORDER
        print(f"[GRADIA] {path} not found, using default LabelEncoder order: {order}")

    # Fail loudly instead of silently mislabeling predictions
    if sorted(order) != sorted(CLASS_INFO.keys()) or len(order) != 7:
        raise ValueError(f"Class order {order} does not match expected HAM10000 classes")
    return order


CLASS_ORDER = _load_class_order()

# index -> class info, built from the training order
HAM10000_CLASSES = {i: CLASS_INFO[code] for i, code in enumerate(CLASS_ORDER)}

# ImageNet normalization stats
PREPROCESS = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])


class GradCAMHooks:
    """Captures forward activations and backward gradients from the target layer."""

    def __init__(self):
        self.activations = None
        self.gradients = None

    def forward_hook(self, module, input, output):
        self.activations = output.detach()

    def backward_hook(self, module, grad_in, grad_out):
        self.gradients = grad_out[0].detach()


class GradiaInference:
    """
    Loads ResNet-50, runs classification inference,
    and computes Grad-CAM heatmaps for explainability.
    """

    # Absolute path, so it works no matter which folder uvicorn is started from
    WEIGHTS_PATH = BASE_DIR / "weights" / "resnet50_ham10000.pth"

    def __init__(self, weights_path: str = None, device: str = None):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.weights_loaded = False
        self.model = self._load_model(Path(weights_path) if weights_path else self.WEIGHTS_PATH)
        self.hooks = GradCAMHooks()
        self._register_hooks()
        # Grad-CAM stores activations/gradients on shared hook state, so two requests
        # running at the same time could mix up each other's results. One at a time.
        self._lock = threading.Lock()

    def _load_model(self, weights_path: Path) -> nn.Module:
        model = models.resnet50(weights=None)
        model.fc = nn.Linear(model.fc.in_features, 7)

        if weights_path.exists():
            state_dict = torch.load(weights_path, map_location=self.device)
            model.load_state_dict(state_dict)
            self.weights_loaded = True
            print(f"[GRADIA] Loaded weights from {weights_path}")
        elif os.getenv("ALLOW_UNTRAINED_MODEL") == "1":
            # Explicit opt-in only: ImageNet backbone + RANDOM head = meaningless predictions
            print(f"[GRADIA] WARNING: no weights at {weights_path}. "
                  f"ALLOW_UNTRAINED_MODEL=1, so using an UNTRAINED head. Predictions are NOT valid.")
            model = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V2)
            model.fc = nn.Linear(model.fc.in_features, 7)
        else:
            # Fail loudly instead of silently serving random predictions
            raise FileNotFoundError(
                f"Model weights not found at {weights_path}. "
                f"Place resnet50_ham10000.pth there (or set ALLOW_UNTRAINED_MODEL=1 for UI-only testing)."
            )

        model.to(self.device)
        model.eval()
        return model

    def _register_hooks(self):
        # Attach to last conv layer for Grad-CAM
        target_layer = self.model.layer4[-1]
        target_layer.register_forward_hook(self.hooks.forward_hook)
        target_layer.register_full_backward_hook(self.hooks.backward_hook)

    def predict(self, image_bytes: bytes) -> Dict[str, Any]:
        """Run classification on raw image bytes. Returns class, confidence, and metadata."""
        tensor = self._bytes_to_tensor(image_bytes)

        with torch.set_grad_enabled(False):
            logits = self.model(tensor)
            probs = F.softmax(logits, dim=1)

        confidence, class_idx = torch.max(probs, dim=1)
        class_idx = class_idx.item()
        confidence = round(confidence.item() * 100, 2)
        class_info = HAM10000_CLASSES[class_idx]

        return {
            "class_idx": class_idx,
            "class_code": CLASS_ORDER[class_idx],
            "predicted_class": class_info["label"],
            "confidence": confidence,
            "severity": class_info["severity"],
            "description": class_info["description"],
            "all_probs": {
                HAM10000_CLASSES[i]["label"]: round(probs[0][i].item() * 100, 2)
                for i in range(7)
            }
        }

    def compute_gradcam(self, image_bytes: bytes, class_idx: int) -> np.ndarray:
        """
        Compute normalized Grad-CAM heatmap for the given class.

        Steps:
          1. Forward pass to capture layer4 activations
          2. Backward pass on target class score to capture gradients
          3. Global average pool gradients to get per-channel weights
          4. Weighted sum of activation maps
          5. ReLU to keep only positive contributions
          6. Normalize to [0, 1]

        Returns float32 array of shape (H, W) with values in [0, 1].
        """
        tensor = self._bytes_to_tensor(image_bytes)

        self.model.zero_grad()
        logits = self.model(tensor)

        target_score = logits[0, class_idx]
        target_score.backward()

        if self.hooks.activations is None or self.hooks.gradients is None:
            raise RuntimeError("Grad-CAM hooks did not capture activations/gradients")

        activations = self.hooks.activations[0]   # (C, H, W) = (2048, 7, 7)
        gradients = self.hooks.gradients[0]        # (C, H, W)

        weights = gradients.mean(dim=[1, 2])       # (C,)  one importance weight per channel

        # Weighted sum of the 2048 feature maps -> one 7x7 map
        cam = (weights[:, None, None] * activations).sum(dim=0)

        cam = F.relu(cam)
        cam_np = cam.detach().cpu().numpy()
        self.model.zero_grad()

        cam_min, cam_max = cam_np.min(), cam_np.max()
        if cam_max - cam_min > 1e-8:
            cam_np = (cam_np - cam_min) / (cam_max - cam_min)
        else:
            cam_np = np.zeros_like(cam_np)

        return cam_np.astype(np.float32)

    @staticmethod
    def _model_crop_box(w: int, h: int):
        """
        Where the 224x224 model input sits inside the ORIGINAL image.
        Mirrors PREPROCESS: Resize(256) on the shorter side, then CenterCrop(224).
        Returns (x0, y0, x1, y1) in original-image pixels.
        """
        if w <= h:
            rw, rh = 256, int(256 * h / w)
        else:
            rw, rh = int(256 * w / h), 256
        scale = 256 / min(w, h)
        left = int(round((rw - 224) / 2.0))
        top = int(round((rh - 224) / 2.0))
        x0, y0 = int(round(left / scale)), int(round(top / scale))
        size = int(round(224 / scale))
        return x0, y0, min(w, x0 + size), min(h, y0 + size)

    def generate_gradcam_png(self, image_bytes: bytes, class_idx: int) -> bytes:
        """
        Overlay the Grad-CAM heatmap (JET colormap) on the original image.
        The heatmap is placed ONLY over the center region the model actually saw,
        and that region is outlined. Returns PNG bytes ready for storage.
        """
        heatmap = self.compute_gradcam(image_bytes, class_idx)

        original = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        orig_w, orig_h = original.size
        orig_np = np.array(original)

        x0, y0, x1, y1 = self._model_crop_box(orig_w, orig_h)

        heatmap_resized = cv2.resize(heatmap, (x1 - x0, y1 - y0))
        heatmap_uint8 = (heatmap_resized * 255).astype(np.uint8)
        heatmap_color = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)
        heatmap_rgb = cv2.cvtColor(heatmap_color, cv2.COLOR_BGR2RGB)

        blended = orig_np.copy()
        blended[y0:y1, x0:x1] = cv2.addWeighted(orig_np[y0:y1, x0:x1], 0.5, heatmap_rgb, 0.5, 0)
        cv2.rectangle(blended, (x0, y0), (x1 - 1, y1 - 1), (255, 255, 255), max(1, orig_w // 300))

        buf = io.BytesIO()
        Image.fromarray(blended).save(buf, format="PNG", optimize=True)
        return buf.getvalue()

    def analyze(self, image_bytes: bytes):
        """Thread-safe: prediction + Grad-CAM PNG in one locked call. Used by main.py."""
        with self._lock:
            prediction = self.predict(image_bytes)
            heatmap_png = self.generate_gradcam_png(image_bytes, prediction["class_idx"])
        return prediction, heatmap_png

    def generate_gradcam_matrix(self, image_bytes: bytes, class_idx: int) -> str:
        """
        Return Grad-CAM heatmap as compressed JSON matrix.
        Alternative to PNG for lightweight frontend canvas rendering.
        """
        heatmap = self.compute_gradcam(image_bytes, class_idx)
        matrix = [[round(float(v), 3) for v in row] for row in heatmap]
        return json.dumps(matrix)

    def _bytes_to_tensor(self, image_bytes: bytes) -> torch.Tensor:
        """Convert raw image bytes to preprocessed tensor on device."""
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        tensor = PREPROCESS(img).unsqueeze(0).to(self.device)
        tensor.requires_grad_(True)
        return tensor