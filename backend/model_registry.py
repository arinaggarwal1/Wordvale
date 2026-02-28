"""
model_registry.py
Structured metadata for all supported Whisper models via whisper.cpp.
Uses GGML model names matching whisper.cpp's download-ggml-model.sh script.
"""

from typing import Dict, Any, List

MODEL_REGISTRY: Dict[str, Dict[str, Any]] = {
    "tiny": {
        "name": "tiny",
        "display_name": "Tiny",
        "parameter_count": "39M",
        "parameter_count_raw": 39_000_000,
        "estimated_vram_gb": 0.3,
        "disk_size_mb": 75,
        "mem_usage_mb": 273,
        "relative_speed": 32,
        "multilingual_support": True,
        "english_only_variant": "tiny.en",
        "translation_support": True,
        "recommended_use_case": "Quick drafts and testing. Fastest model.",
        "accuracy_tier": "low",
        "ggml_filename": "ggml-tiny.bin",
    },
    "tiny.en": {
        "name": "tiny.en",
        "display_name": "Tiny (English)",
        "parameter_count": "39M",
        "parameter_count_raw": 39_000_000,
        "estimated_vram_gb": 0.3,
        "disk_size_mb": 75,
        "mem_usage_mb": 273,
        "relative_speed": 32,
        "multilingual_support": False,
        "english_only_variant": None,
        "translation_support": False,
        "recommended_use_case": "Fastest English-only transcription.",
        "accuracy_tier": "low",
        "ggml_filename": "ggml-tiny.en.bin",
    },
    "base": {
        "name": "base",
        "display_name": "Base",
        "parameter_count": "74M",
        "parameter_count_raw": 74_000_000,
        "estimated_vram_gb": 0.4,
        "disk_size_mb": 142,
        "mem_usage_mb": 388,
        "relative_speed": 24,
        "multilingual_support": True,
        "english_only_variant": "base.en",
        "translation_support": True,
        "recommended_use_case": "Good balance for quick transcriptions with decent accuracy.",
        "accuracy_tier": "low-medium",
        "ggml_filename": "ggml-base.bin",
    },
    "base.en": {
        "name": "base.en",
        "display_name": "Base (English)",
        "parameter_count": "74M",
        "parameter_count_raw": 74_000_000,
        "estimated_vram_gb": 0.4,
        "disk_size_mb": 142,
        "mem_usage_mb": 388,
        "relative_speed": 24,
        "multilingual_support": False,
        "english_only_variant": None,
        "translation_support": False,
        "recommended_use_case": "Reliable English-only transcription.",
        "accuracy_tier": "low-medium",
        "ggml_filename": "ggml-base.en.bin",
    },
    "small": {
        "name": "small",
        "display_name": "Small",
        "parameter_count": "244M",
        "parameter_count_raw": 244_000_000,
        "estimated_vram_gb": 0.9,
        "disk_size_mb": 466,
        "mem_usage_mb": 852,
        "relative_speed": 16,
        "multilingual_support": True,
        "english_only_variant": "small.en",
        "translation_support": True,
        "recommended_use_case": "Good accuracy for most languages.",
        "accuracy_tier": "medium",
        "ggml_filename": "ggml-small.bin",
    },
    "small.en": {
        "name": "small.en",
        "display_name": "Small (English)",
        "parameter_count": "244M",
        "parameter_count_raw": 244_000_000,
        "estimated_vram_gb": 0.9,
        "disk_size_mb": 466,
        "mem_usage_mb": 852,
        "relative_speed": 16,
        "multilingual_support": False,
        "english_only_variant": None,
        "translation_support": False,
        "recommended_use_case": "Strong English-only accuracy.",
        "accuracy_tier": "medium",
        "ggml_filename": "ggml-small.en.bin",
    },
    "medium": {
        "name": "medium",
        "display_name": "Medium",
        "parameter_count": "769M",
        "parameter_count_raw": 769_000_000,
        "estimated_vram_gb": 2.1,
        "disk_size_mb": 1500,
        "mem_usage_mb": 2100,
        "relative_speed": 8,
        "multilingual_support": True,
        "english_only_variant": "medium.en",
        "translation_support": True,
        "recommended_use_case": "High accuracy for professional multilingual transcription.",
        "accuracy_tier": "high",
        "ggml_filename": "ggml-medium.bin",
    },
    "medium.en": {
        "name": "medium.en",
        "display_name": "Medium (English)",
        "parameter_count": "769M",
        "parameter_count_raw": 769_000_000,
        "estimated_vram_gb": 2.1,
        "disk_size_mb": 1500,
        "mem_usage_mb": 2100,
        "relative_speed": 8,
        "multilingual_support": False,
        "english_only_variant": None,
        "translation_support": False,
        "recommended_use_case": "Professional-grade English transcription.",
        "accuracy_tier": "high",
        "ggml_filename": "ggml-medium.en.bin",
    },
    "large-v3": {
        "name": "large-v3",
        "display_name": "Large v3",
        "parameter_count": "1550M",
        "parameter_count_raw": 1_550_000_000,
        "estimated_vram_gb": 3.9,
        "disk_size_mb": 2900,
        "mem_usage_mb": 3900,
        "relative_speed": 4,
        "multilingual_support": True,
        "english_only_variant": None,
        "translation_support": True,
        "recommended_use_case": "Maximum accuracy across all languages.",
        "accuracy_tier": "very-high",
        "ggml_filename": "ggml-large-v3.bin",
    },
    "large-v3-turbo": {
        "name": "large-v3-turbo",
        "display_name": "Large v3 Turbo",
        "parameter_count": "809M",
        "parameter_count_raw": 809_000_000,
        "estimated_vram_gb": 2.0,
        "disk_size_mb": 1600,
        "mem_usage_mb": 2400,
        "relative_speed": 16,
        "multilingual_support": True,
        "english_only_variant": None,
        "translation_support": True,
        "recommended_use_case": "Fast with near-large accuracy. Recommended default.",
        "accuracy_tier": "high",
        "ggml_filename": "ggml-large-v3-turbo.bin",
    },
}


def get_model_info(model_name: str) -> Dict[str, Any]:
    """Get detailed info for a specific model."""
    if model_name in MODEL_REGISTRY:
        return MODEL_REGISTRY[model_name]
    return {"error": f"Unknown model: {model_name}"}


def get_all_models() -> List[Dict[str, Any]]:
    """Return a list of all available models with their metadata."""
    return list(MODEL_REGISTRY.values())


def get_model_names() -> List[str]:
    """Return a list of all available model names."""
    return list(MODEL_REGISTRY.keys())


def get_recommended_model(has_gpu: bool, vram_gb: float = 0) -> str:
    """Suggest a model based on available hardware."""
    if has_gpu:
        if vram_gb >= 4:
            return "large-v3-turbo"
        elif vram_gb >= 2:
            return "medium"
        elif vram_gb >= 1:
            return "small"
        else:
            return "base"
    else:
        return "base.en"
