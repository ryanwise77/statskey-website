#!/usr/bin/env python3
"""Mechanical clearance checks for the current CBM G1 assembly.

This is an interference/stack-up check, not a substitute for tolerance
analysis on vendor-returned CAD, insertion-force testing, or enclosure FEA.
"""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass
from pathlib import Path

from cadquery import importers


ROOT = Path(__file__).resolve().parent
BIOCOIN_STEP = ROOT / "vendor" / "Biocoin_v1.3.step"


@dataclass(frozen=True)
class Design:
    shell_od: float = 44.0
    shell_wall: float = 1.5
    shell_inner_top: float = 18.00
    shell_top: float = 19.00

    daughterboard_od: float = 38.0
    daughterboard_bottom: float = 2.24
    daughterboard_thickness: float = 0.80
    daughter_component_height: float = 1.60

    cartridge_connector_initial: float = 2.54
    cartridge_connector_working: float = 2.24
    cartridge_connector_stroke: float = 0.61

    biocoin_connector_initial: float = 6.782
    biocoin_connector_working: float = 6.08
    biocoin_connector_stroke: float = 1.397

    battery_x: float = -11.50
    battery_y: float = 0.0
    battery_diameter: float = 12.10
    battery_height: float = 4.0
    battery_bottom: float = 12.95
    battery_rf_keepout: float = 2.0

    lmp_radius: float = 15.80
    lmp_radial_size: float = 3.90
    daughter_edge_keepout: float = 1.0

    cartridge_frame_od: float = 40.0
    adhesive_od: float = 54.0
    adhesive_bottom: float = -0.87
    needle_tip: float = -1.65

    connector_contacts: int = 12
    connector_force_gf_each: float = 60.0
    latch_safety_factor: float = 2.5

    @property
    def shell_inner_radius(self) -> float:
        return self.shell_od / 2 - self.shell_wall

    @property
    def daughterboard_top(self) -> float:
        return self.daughterboard_bottom + self.daughterboard_thickness

    @property
    def board_bottom_plane(self) -> float:
        return self.daughterboard_top + self.biocoin_connector_working

    @property
    def battery_top(self) -> float:
        return self.battery_bottom + self.battery_height


@dataclass
class Check:
    name: str
    actual: float
    minimum: float
    unit: str = "mm"
    note: str = ""

    @property
    def passed(self) -> bool:
        return self.actual + 1e-9 >= self.minimum


def circle_to_rect_clearance(
    cx: float,
    cy: float,
    radius: float,
    xmin: float,
    xmax: float,
    ymin: float,
    ymax: float,
) -> float:
    nearest_x = min(max(cx, xmin), xmax)
    nearest_y = min(max(cy, ymin), ymax)
    return math.hypot(cx - nearest_x, cy - nearest_y) - radius


def analyze() -> tuple[Design, dict[str, float], list[Check]]:
    d = Design()
    model = importers.importStep(str(BIOCOIN_STEP)).val()
    bbox = model.BoundingBox()
    solids = model.Solids()

    pcb = max(solids, key=lambda solid: solid.Volume())
    pcb_box = pcb.BoundingBox()

    raytac = min(
        solids,
        key=lambda solid: abs(solid.BoundingBox().xlen - 15.5)
        + abs(solid.BoundingBox().ylen - 10.5)
        + abs(solid.BoundingBox().zlen - 2.05),
    )
    ray_box = raytac.BoundingBox()

    fpc = min(
        solids,
        key=lambda solid: abs(solid.BoundingBox().xlen - 3.6)
        + abs(solid.BoundingBox().ylen - 11.7)
        + abs(solid.BoundingBox().zlen - 1.9),
    )
    fpc_box = fpc.BoundingBox()

    center_x = (bbox.xmin + bbox.xmax) / 2
    center_y = (bbox.ymin + bbox.ymax) / 2
    z_shift = d.board_bottom_plane - pcb_box.zmin

    board_model_bottom = bbox.zmin + z_shift
    board_model_top = bbox.zmax + z_shift
    daughter_components_top = d.daughterboard_top + d.daughter_component_height

    board_half_diagonal = math.hypot(bbox.xlen / 2, bbox.ylen / 2)
    battery_radius = d.battery_diameter / 2
    battery_outer_radius = math.hypot(d.battery_x, d.battery_y) + battery_radius

    ray_clearance = circle_to_rect_clearance(
        d.battery_x,
        d.battery_y,
        battery_radius,
        ray_box.xmin - center_x,
        ray_box.xmax - center_x,
        ray_box.ymin - center_y,
        ray_box.ymax - center_y,
    )

    lmp_outer_radius = d.lmp_radius + d.lmp_radial_size / 2
    connector_force_n = (
        d.connector_contacts * d.connector_force_gf_each * 0.00980665
    )

    checks = [
        Check(
            "Biocoin populated XY envelope inside shell",
            d.shell_inner_radius - board_half_diagonal,
            1.5,
            note="Conservative rectangular-envelope diagonal.",
        ),
        Check(
            "Daughterboard edge inside shell",
            d.shell_inner_radius - d.daughterboard_od / 2,
            1.0,
        ),
        Check(
            "LMP7721 package edge on daughterboard",
            d.daughterboard_od / 2 - lmp_outer_radius,
            d.daughter_edge_keepout,
        ),
        Check(
            "Biocoin bottom component to daughterboard components",
            board_model_bottom - daughter_components_top,
            0.5,
            note="Excludes the four intentional spring-header interfaces.",
        ),
        Check(
            "Battery to highest Biocoin component",
            d.battery_bottom - board_model_top,
            0.8,
        ),
        Check(
            "Battery to shell inner top",
            d.shell_inner_top - d.battery_top,
            0.8,
        ),
        Check(
            "Battery radial edge to shell",
            d.shell_inner_radius - battery_outer_radius,
            2.0,
        ),
        Check(
            "Battery XY clearance from full Raytac module body",
            ray_clearance,
            d.battery_rf_keepout,
            note="Conservative: clears the entire module, not only its antenna.",
        ),
        Check(
            "Cartridge connector compression",
            d.cartridge_connector_initial - d.cartridge_connector_working,
            0.30,
            note=f"Full available stroke {d.cartridge_connector_stroke:.2f} mm.",
        ),
        Check(
            "Biocoin header compression",
            d.biocoin_connector_initial - d.biocoin_connector_working,
            0.69,
            note=f"Full available stroke {d.biocoin_connector_stroke:.3f} mm.",
        ),
        Check(
            "Needle protrusion beyond adhesive skin plane",
            d.adhesive_bottom - d.needle_tip,
            0.70,
        ),
        Check(
            "Latch retention design load",
            connector_force_n * d.latch_safety_factor,
            17.5,
            unit="N",
            note=f"Connector preload ≈ {connector_force_n:.2f} N.",
        ),
    ]

    measured = {
        "biocoin_x": bbox.xlen,
        "biocoin_y": bbox.ylen,
        "biocoin_z": bbox.zlen,
        "pcb_thickness": pcb_box.zlen,
        "biocoin_bottom_component_depth": pcb_box.zmin - bbox.zmin,
        "biocoin_top_component_height": bbox.zmax - pcb_box.zmax,
        "fpc_x": fpc_box.xlen,
        "fpc_y": fpc_box.ylen,
        "fpc_z": fpc_box.zlen,
        "board_model_bottom": board_model_bottom,
        "board_model_top": board_model_top,
        "raytac_x": ray_box.xlen,
        "raytac_y": ray_box.ylen,
        "raytac_z": ray_box.zlen,
        "connector_force_n": connector_force_n,
    }
    return d, measured, checks


def markdown(d: Design, measured: dict[str, float], checks: list[Check]) -> str:
    rows = []
    for check in checks:
        rows.append(
            f"| {'PASS' if check.passed else 'FAIL'} | {check.name} | "
            f"{check.actual:.2f} {check.unit} | ≥ {check.minimum:.2f} "
            f"{check.unit} | {check.note} |"
        )
    status = "PASS" if all(check.passed for check in checks) else "FAIL"
    return f"""# CBM G1 — Mechanical Fit Report

Generated by `cad/validate_mechanical_stack.py` from the actual upstream
`Biocoin_v1.3.step`.

Overall geometric stack status: **{status}**

## Measured upstream geometry

- populated Biocoin envelope: **{measured['biocoin_x']:.3f} × {measured['biocoin_y']:.3f} × {measured['biocoin_z']:.3f} mm**
- PCB thickness in STEP: **{measured['pcb_thickness']:.3f} mm**
- deepest bottom-side component below PCB: **{measured['biocoin_bottom_component_depth']:.3f} mm**
- highest top-side component above PCB: **{measured['biocoin_top_component_height']:.3f} mm**
- Molex FPC body envelope: **{measured['fpc_x']:.3f} × {measured['fpc_y']:.3f} × {measured['fpc_z']:.3f} mm**
- Raytac module envelope: **{measured['raytac_x']:.3f} × {measured['raytac_y']:.3f} × {measured['raytac_z']:.3f} mm**

## Frozen axial stack

| Plane | Z (mm) |
| --- | ---: |
| cartridge hard-gold pad plane | 0.00 |
| interface daughterboard bottom | {d.daughterboard_bottom:.2f} |
| interface daughterboard top | {d.daughterboard_top:.2f} |
| Biocoin PCB bottom pad plane | {d.board_bottom_plane:.2f} |
| populated Biocoin lowest point | {measured['board_model_bottom']:.2f} |
| populated Biocoin highest point | {measured['board_model_top']:.2f} |
| CP1240 battery bottom | {d.battery_bottom:.2f} |
| CP1240 battery top | {d.battery_top:.2f} |
| shell inner ceiling | {d.shell_inner_top:.2f} |
| shell exterior top | {d.shell_top:.2f} |

## Clearance checks

| Result | Check | Actual | Requirement | Note |
| --- | --- | ---: | ---: | --- |
{chr(10).join(rows)}

## Assembly hardware now represented

- four upstream-exact Biocoin docking headers:
  `855-22-010-10-001101` ×2 and `855-22-008-10-001101` ×2;
- one 12-position ultra-low-profile cartridge connector:
  `817-22-012-30-001101`, modeled at 2.24 mm working height;
- one 38 mm full daughterboard carrying six LMP7721 buffers, ADS124S08,
  connector footprints, guarded routing, and the cartridge connector;
- an offset, tabbed VARTA CP1240 in a shell-supported cradle, with a JST
  ACHR-02V-S / SACH-003G-P0.2 harness to the Biocoin battery header;
- four board-edge capture clips derived from the upstream Biocoin fixture;
- three cartridge snap hooks and a hard compression stop sized for at least
  **{measured['connector_force_n'] * d.latch_safety_factor:.1f} N** retention;
- a die-cut contact gasket and a separate enclosure seam gasket.

## What this report does not prove

- molded snap-hook fatigue or release force (requires FEA and cycle testing);
- gasket compression set and sweat-ingress performance;
- actual antenna efficiency in the final enclosure (requires VNA/OTA testing);
- connector coplanarity after real assembly;
- microneedle insertion, fracture, coating, and biological performance;
- vendor tolerances until production drawings and return CAD are received.
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-report", type=Path)
    args = parser.parse_args()
    design, measured, checks = analyze()
    report = markdown(design, measured, checks)
    print(report)
    if args.write_report:
        args.write_report.write_text(report)
    if not all(check.passed for check in checks):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
