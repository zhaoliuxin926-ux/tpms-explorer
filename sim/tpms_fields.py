# -*- coding: utf-8 -*-
"""Shared TPMS implicit field evaluators aligned with tpms-platform/src/core/tpms-functions.ts.

Supports 9 classical periodic implicit families:
  gyroid, diamond, schwarz, neovius, iwp, frd, lidinoid, splitp, fks
"""
import numpy as np


def evaluate_field(ftype: str, x: np.ndarray, y: np.ndarray, z: np.ndarray) -> np.ndarray:
    """Evaluate dimensionless TPMS scalar field f(x, y, z) on radians grid."""
    t = ftype.lower().strip()
    if t == "gyroid":
        return np.sin(x) * np.cos(y) + np.sin(y) * np.cos(z) + np.sin(z) * np.cos(x)
    if t == "diamond":
        return (
            np.sin(x) * np.sin(y) * np.sin(z)
            + np.sin(x) * np.cos(y) * np.cos(z)
            + np.cos(x) * np.sin(y) * np.cos(z)
            + np.cos(x) * np.cos(y) * np.sin(z)
        )
    if t == "schwarz":
        return np.cos(x) + np.cos(y) + np.cos(z)
    if t == "neovius":
        return 3.0 * (np.cos(x) + np.cos(y) + np.cos(z)) + 4.0 * np.cos(x) * np.cos(y) * np.cos(z)
    if t == "iwp":
        return (
            2.0 * (np.cos(x) * np.cos(y) + np.cos(y) * np.cos(z) + np.cos(z) * np.cos(x))
            - (np.cos(2.0 * x) + np.cos(2.0 * y) + np.cos(2.0 * z))
        )
    if t == "frd":
        return (
            4.0 * np.cos(x) * np.cos(y) * np.cos(z)
            - (np.cos(2.0 * x) * np.cos(2.0 * y) + np.cos(2.0 * y) * np.cos(2.0 * z) + np.cos(2.0 * z) * np.cos(2.0 * x))
        )
    if t == "lidinoid":
        sx, cx = np.sin(x), np.cos(x)
        sy, cy = np.sin(y), np.cos(y)
        sz, cz = np.sin(z), np.cos(z)
        return (
            0.5 * (2.0 * sx * cx * cy * sz + 2.0 * sy * cy * cz * sx + 2.0 * sz * cz * cx * sy)
            - 0.5 * (np.cos(2.0 * x) * np.cos(2.0 * y) + np.cos(2.0 * y) * np.cos(2.0 * z) + np.cos(2.0 * z) * np.cos(2.0 * x))
            + 0.15
        )
    if t == "splitp":
        sx, cx = np.sin(x), np.cos(x)
        sy, cy = np.sin(y), np.cos(y)
        sz, cz = np.sin(z), np.cos(z)
        return (
            1.1 * (2.0 * sx * cx * cy * sz + 2.0 * sx * sy * cy * cz + 2.0 * cx * sy * sz * cz)
            - 0.2 * (np.cos(2.0 * x) * np.cos(2.0 * y) + np.cos(2.0 * y) * np.cos(2.0 * z) + np.cos(2.0 * z) * np.cos(2.0 * x))
            - 0.4 * (np.cos(2.0 * x) + np.cos(2.0 * y) + np.cos(2.0 * z))
        )
    if t == "fks":
        cx, sx = np.cos(x), np.sin(x)
        cy, sy = np.cos(y), np.sin(y)
        cz, sz = np.cos(z), np.sin(z)
        c2x = cx * cx - sx * sx
        c2y = cy * cy - sy * sy
        c2z = cz * cz - sz * sz
        return c2x * sy * cz + cx * c2y * sz + sx * cy * c2z
    raise ValueError(f"Unsupported TPMS family: {ftype}. Supported: {', '.join(SUPPORTED_TYPES)}")


SUPPORTED_TYPES = (
    "gyroid",
    "diamond",
    "schwarz",
    "neovius",
    "iwp",
    "frd",
    "lidinoid",
    "splitp",
    "fks",
)
