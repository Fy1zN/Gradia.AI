"""
GRADIA.AI — Inference Engine
ResNet-50 classifier + Grad-CAM for HAM10000 skin lesion analysis
"""

import io
import json
import numpy as np
from typing import Dict, Any

import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import models, transforms
from PIL import Image
import cv2


# HAM10000 class definitions
HAM10000_CLASSES = {
    0: {
        "label": "Melanocytic Nevus (NV)",
        "severity": "Benign / Safe",
        "description": "Symmetric, uniformly pigmented melanocytic lesion with regular borders and no atypical streaks."
    },
    1: {
        "label": "Melanoma (MEL)",
        "severity": "High Risk",
        "description": "Asymmetric border with irregular pigmentation and multi-chromatic dark zones indicating invasive malignant growth."
    },
    2: {
        "label": "Basal Cell Carcinoma (BCC)",
        "severity": "High Risk",
        "description": "Pearly translucent nodule with telangiectasia and slight central ulceration pattern."
    },
    3: {
        "label": "Actinic Keratosis (AKIEC)",
        "severity": "Moderate Risk",
        "description": "Scaly erythematous plaque with surface hyperkeratosis. Precancerous with potential SCC progression."
    },
    4: {
        "label": "Benign Keratosis (BKL)",
        "severity": "Benign / Safe",
        "description": "Well-demarcated stuck-on appearance with milia-like cysts and comedo-like openings."
    },
    5: {
        "label": "Dermatofibroma (DF)",
        "severity": "Benign / Safe",
        "description": "Firm hyperpigmented papule with central white scar-like area and pseudopod-like projections."
    },
    6: {
        "label": "Vascular Lesion (VASC)",
        "severity": "Benign / Safe",
        "description": "Red-to-violet lacunae with well-defined borders and no pigment network, indicating vascular origin."
    },
}

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

    WEIGHTS_PATH = "weights/resnet50_ham10000.pth"

    def __init__(self, weights_path: str = None, device: str = None):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model = self._load_model(weights_path or self.WEIGHTS_PATH)
        self.hooks = GradCAMHooks()
        self._register_hooks()

    def _load_model(self, weights_path: str) -> nn.Module:
        import os
        model = models.resnet50(weights=None)
        model.fc = nn.Linear(model.fc.in_features, 7)

        if os.path.exists(weights_path):
            state_dict = torch.load(weights_path, map_location=self.device)
            model.load_state_dict(state_dict)
            print(f"[GRADIA] Loaded weights from {weights_path}")
        else:
            # Development fallback — ImageNet backbone, random head
            print(f"[GRADIA] No HAM10000 weights found at {weights_path}. Using ImageNet pretrained backbone.")
            model = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V2)
            model.fc = nn.Linear(model.fc.in_features, 7)

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

        activations = self.hooks.activations[0]   # (C, H, W)
        gradients = self.hooks.gradients[0]        # (C, H, W)

        weights = gradients.mean(dim=[1, 2])       # (C,)

        cam = torch.zeros(activations.shape[1:], device=self.device)
        for i, w in enumerate(weights):
            cam += w * activations[i]

        cam = F.relu(cam)
        cam_np = cam.cpu().numpy()

        cam_min, cam_max = cam_np.min(), cam_np.max()
        if cam_max - cam_min > 1e-8:
            cam_np = (cam_np - cam_min) / (cam_max - cam_min)
        else:
            cam_np = np.zeros_like(cam_np)

        return cam_np.astype(np.float32)

    def generate_gradcam_png(self, image_bytes: bytes, class_idx: int) -> bytes:
        """
        Overlay Grad-CAM heatmap on the original image using JET colormap.
        Returns PNG bytes ready for storage.
        """
        heatmap = self.compute_gradcam(image_bytes, class_idx)

        original = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        orig_w, orig_h = original.size
        orig_np = np.array(original)

        heatmap_resized = cv2.resize(heatmap, (orig_w, orig_h))
        heatmap_uint8 = (heatmap_resized * 255).astype(np.uint8)
        heatmap_color = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)
        heatmap_rgb = cv2.cvtColor(heatmap_color, cv2.COLOR_BGR2RGB)

        blended = cv2.addWeighted(orig_np, 0.5, heatmap_rgb, 0.5, 0)

        buf = io.BytesIO()
        Image.fromarray(blended).save(buf, format="PNG", optimize=True)
        return buf.getvalue()

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